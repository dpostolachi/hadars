import { expect, test } from 'bun:test';
import { BunnyTarget, type Revision } from '../../src/deploy/bunny';
const revision = (n = 1): Revision => ({ project: 'demo', environment: 'dev', revision: n, artifact: { entry: 'bunny.mjs', files: [{ path: 'bunny.mjs', bytes: new TextEncoder().encode('hello') }] } });
function fake(smoke = 200) {
    const calls: Array<{ method: string; path: string; body?: any }> = [];
    const client = {
        async request(method: string, path: string, body?: any) {
            calls.push({ method, path, body });
            if (path === '/pullzone') return [];
            if (path.split('?')[0] === '/compute/script' && method === 'POST') return { Id: 9 };
            if (path === '/compute/script/9') return { DefaultHostname: 'https://demo.bunny.run' };
            if (path.split('?')[0] === '/compute/script') return { Items: Array.from({ length: 8 }, (_, i) => ({ Id: i + 1, Name: `demo-dev-r${i + 1}` })) };
            return {};
        },
        async publish(id: string, code: string) { calls.push({ method: 'publish', path: id, body: code }); },
    };
    const send = (async (url: any) => { calls.push({ method: 'smoke', path: String(url) }); return new Response('ok', { status: smoke }); }) as typeof fetch;
    return { target: new BunnyTarget({ key: 'fake', publicZoneId: '99', storageZone: 'assets', storageKey: 'fake' }, send, client, async () => {}), calls };
}
test('plans locally and explains size per file/module', () => {
    const { target, calls } = fake();
    expect(target.plan(revision()).artifactSummary).toEqual({ files: 1, bytes: 5 });
    const big = revision(); big.artifact.files[0].bytes = new Uint8Array(10_000_001); big.artifact.files[0].module = 'shell';
    expect(() => target.plan(big)).toThrow('bunny.mjs (shell): 10000001 bytes');
    expect(calls).toEqual([]);
});
test('stage, verify, activate and rollback switch only the public pointer', async () => {
    const { target, calls } = fake();
    const staged = await target.stage(target.plan(revision(9)));
    expect(await target.verify(staged)).toEqual({ ok: true });
    await target.activate(staged);
    await target.rollback({ ...staged, scriptId: '8', revision: 0 });
    expect(calls.map(c => c.method)).toEqual(['GET', 'POST', 'GET', 'GET', 'publish', 'smoke', 'POST', 'POST', 'POST', 'POST']);
    // each activation moves the pointer and then purges the public zone's cache
    expect(calls[7].path).toBe('/pullzone/99/purgeCache');
    expect(calls[9].path).toBe('/pullzone/99/purgeCache');
    expect(calls[1].body).toEqual({ Name: 'demo-dev-r9', ScriptType: 1, CreateLinkedPullZone: true });
    expect(calls[6].body).toEqual({ EdgeScriptId: 9, OriginType: 4, OriginUrl: 'https://bunnycdn.com' });
    expect(calls[8].body.EdgeScriptId).toBe(8);
});
test('verify failure makes no live mutation', async () => {
    const { target, calls } = fake(503);
    const staged = await target.stage(target.plan(revision(9)));
    expect((await target.verify(staged)).ok).toBe(false);
    expect(calls.some(c => c.path === '/pullzone/99')).toBe(false);
});
test('retention keeps five including live and previous even when old', async () => {
    const { target, calls } = fake();
    await target.retain('demo', 'dev', '1', '2');
    expect(calls.filter(c => c.method === 'DELETE').map(c => c.path)).toEqual(['/compute/script/5', '/compute/script/4', '/compute/script/3']);
});

test('incomplete immutable code readback refuses reuse before publication', async () => {
    const { target, calls } = fake();
    await expect(target.stage(target.plan(revision(1)))).rejects.toThrow('immutable script');
    expect(calls).toHaveLength(2);
});
test('assets upload and read back; collisions and corrupt uploads refuse staging', async () => {
    for (const mode of ['upload', 'existing', 'collision', 'corrupt'] as const) {
        const assets = new Map<string, Uint8Array>();
        const bytes = new TextEncoder().encode('asset');
        if (mode === 'existing' || mode === 'collision') assets.set('asset.abcdef12.js', mode === 'existing' ? bytes : new Uint8Array([0]));
        const operations: string[] = [];
        let published = false;
        const send = (async (url: any, init: any) => {
            const path = new URL(String(url)).pathname.split('/').at(-1)!;
            const method = init?.method ?? 'GET'; operations.push(method);
            if (method === 'PUT') { assets.set(path, mode === 'corrupt' ? new Uint8Array([1]) : new Uint8Array(init.body)); return new Response(); }
            return assets.has(path) ? new Response(new Uint8Array(assets.get(path)!)) : new Response(null, { status: 404 });
        }) as typeof fetch;
        const client = { async request(method: string, path: string) { if (path === '/pullzone') return []; return path.split('?')[0] === '/compute/script' && method === 'GET' ? [] : path.split('?')[0] === '/compute/script' ? { Id: 9 } : { DefaultHostname: 'demo.bunny.run' }; }, async publish() { published = true; } };
        const target = new BunnyTarget({ key: 'fake', publicZoneId: '99', storageZone: 'assets', storageKey: 'fake' }, send, client);
        const input = revision(); input.artifact.files.push({ path: 'asset.abcdef12.js', bytes });
        if (mode === 'collision' || mode === 'corrupt') {
            await expect(target.stage(target.plan(input))).rejects.toThrow(mode === 'collision' ? 'collision' : 'verification');
            expect(published).toBe(false);
        } else {
            await target.stage(target.plan(input));
            expect(published).toBe(true);
            expect(operations).toEqual(mode === 'upload' ? ['GET', 'PUT', 'GET'] : ['GET']);
        }
    }
});

test('static objects transfer concurrently, and a failure names the first bad file in order', async () => {
    const files = Array.from({ length: 40 }, (_, i) => ({ path: `a${String(i).padStart(2, '0')}.abcdef12.js`, bytes: new TextEncoder().encode(`asset ${i}`) }));
    for (const bad of [undefined, 'a07.abcdef12.js', 'a31.abcdef12.js']) {
        const assets = new Map<string, Uint8Array>();
        let inFlight = 0, peak = 0, published = false;
        const send = (async (url: any, init: any) => {
            const path = new URL(String(url)).pathname.split('/').at(-1)!;
            inFlight++; peak = Math.max(peak, inFlight);
            await new Promise(r => setTimeout(r, 2));
            inFlight--;
            if ((init?.method ?? 'GET') === 'PUT') { assets.set(path, path === bad || path === 'a31.abcdef12.js' && bad === 'a07.abcdef12.js' ? new Uint8Array([1]) : new Uint8Array(init.body)); return new Response(); }
            return assets.has(path) ? new Response(new Uint8Array(assets.get(path)!)) : new Response(null, { status: 404 });
        }) as typeof fetch;
        const client = { async request(method: string, path: string) { if (path === '/pullzone') return []; return path.split('?')[0] === '/compute/script' && method === 'GET' ? [] : path.split('?')[0] === '/compute/script' ? { Id: 9 } : { DefaultHostname: 'demo.bunny.run' }; }, async publish() { published = true; } };
        const target = new BunnyTarget({ key: 'fake', publicZoneId: '99', storageZone: 'assets', storageKey: 'fake' }, send, client);
        const input = revision(); input.artifact.files.push(...files);
        if (!bad) {
            const staged = await target.stage(target.plan(input));
            expect(staged.assets).toEqual({ reused: 0, uploaded: 40 });
            expect(assets.size).toBe(40);
            expect(peak).toBeGreaterThan(1);
            expect(peak).toBeLessThanOrEqual(12);
        } else {
            await expect(target.stage(target.plan(input))).rejects.toThrow(`Asset verification failed: ${bad}`);
            expect(published).toBe(false);
        }
    }
});

test('retention owns config variants, preserves old live/previous, leaves lookalikes and foreign scripts', async () => {
    const { mockProvider } = await import('./helpers/mockProvider');
    const mock = mockProvider();
    const names = ['demo-dev-r1', 'demo-dev-r1-c1', 'demo-dev-r1-c2', 'demo-dev-r1-c3', 'demo-dev-r2', 'demo-dev-r2-c2', 'demo-dev-r2-c3', 'demo-dev-r1-c2-other', 'demo-dev-r1-c0', 'demo-other-r1-c2', 'introtrace-website'];
    for (const [index, Name] of names.entries()) mock.tables['/compute/script'].push({ Id: index + 1, Name });
    const target = new BunnyTarget({ key: 'mock', storageKey: 'mock', storageZone: 'demo', publicZoneId: '1' }, mock.send, mock.client);
    await target.retain('demo', 'dev', '1', '2');
    const deletes = mock.calls.filter(c => c.startsWith('DELETE'));
    expect(deletes.sort()).toEqual(['DELETE /compute/script/3', 'DELETE /compute/script/4']);
});
