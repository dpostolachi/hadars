import { test, expect } from 'bun:test';
import names from './fixtures/static-paths.json';
import { staticLayout, hashedShellPath, setupBunny, BunnyTarget, gcCandidates, listStaticObjects, deleteStaticObjects, type Artifact } from '../../src/deploy/bunny';
import { mockProvider } from './helpers/mockProvider';
import type { GcRecord as Deployment } from '../../src/deploy/bunny/gc';
const bytes = (s: string) => new TextEncoder().encode(s);
const artifact = (body = 'hello'): Artifact => ({ entry: 'bunny.mjs', files: [{ path: 'bunny.mjs', bytes: bytes(body) }, ...names.map(path => ({ path, bytes: bytes(path) }))] });
test('real 134-name inventory: 40 hashed JS, three hashed discovery, five pinned clients and 86 stable files', () => {
    expect(names).toHaveLength(134);
    expect(names.filter(hashedShellPath)).toHaveLength(43);
    const layout = staticLayout(artifact());
    expect(layout.files.filter(f => f.path.startsWith('_shell/'))).toHaveLength(86);
    expect(layout.files.filter(f => f.path.startsWith('_builds/'))).toHaveLength(5);
    expect(layout.paths).toContain('index.c162c059.js');
    expect(layout.paths).toContain(`_shell/${layout.shellBuildId}/robots.txt`);
    expect(layout.paths).toContain(`_shell/${layout.shellBuildId}/90c6422090fbffb9c3ad7f3095e69773.txt`);
    expect(staticLayout(artifact('changed')).shellBuildId).not.toBe(layout.shellBuildId);
    expect(staticLayout(artifact()).paths).toEqual(layout.paths);
});
test('stable runtime metadata fails closed rather than silently breaking URLs', () => {
    const a = artifact(); a.files.push({ path: 'out2.html', bytes: bytes('<meta name="HADARS_ASSET_BASE" content="'+encodeURIComponent(JSON.stringify({ files: ['robots.txt'] }))+'">') });
    expect(() => staticLayout(a)).toThrow('stable shell paths');
});
test('setup is idempotent, shares project storage across environments, and preserves public pointer', async () => {
    const mock = mockProvider(), out: string[] = [];
    const first = await setupBunny(mock.client, 'demo', 'dev', s => out.push(s));
    const count = mock.calls.filter(c => c.startsWith('POST')).length;
    await setupBunny(mock.client, 'demo', 'dev', s => out.push(s));
    expect(mock.calls.filter(c => c.startsWith('POST'))).toHaveLength(count);
    const second = await setupBunny(mock.client, 'demo', 'preview-x', s => out.push(s));
    expect(second.storageZone).toEqual(first.storageZone);
    expect(second.assetsPullZone).toEqual(first.assetsPullZone);
    expect(second.publicZones['preview-x'].id).not.toBe(first.publicZones.dev.id);
    expect(out.some(s => s.startsWith('Found'))).toBe(true);
    expect(mock.calls.some(c => c.startsWith('DELETE'))).toBe(false);
});
test('shared bytes dedup across revisions, stable outputs isolated; base is project root on both scripts', async () => {
    const mock = mockProvider();
    let puts = 0;
    const send = (async (url: any, init: any) => { if (init?.method === 'PUT') puts++; return mock.send(url,init); }) as typeof fetch;
    const target = new BunnyTarget({ key: 'mock', publicZoneId: '1', storageZone: 'demo', storageKey: 'mock', assetsHost: 'demo-assets.b-cdn.net' }, send, mock.client);
    const config = { variables: { HADARS_ASSET_BASE_URL: 'https://demo-assets.b-cdn.net' }, secrets: {}, required: ['HADARS_ASSET_BASE_URL'] };
    for (const revision of [1,2]) {
        const a = artifact(String(revision));
        await target.stage(target.plan({ project: 'demo', environment: 'dev', revision, artifact: a }, config), config);
    }
    // 48 shared + two immutable archives of 86 stable outputs.
    expect(mock.objects.size).toBe(48 + 86 * 2);
    expect(puts).toBe(48 + 86 * 2);
    await target.stage(target.plan({ project: 'demo', environment: 'preview-x', revision: 1, artifact: artifact('2') }, config), config);
    expect(puts).toBe(48 + 86 * 2);
    expect(mock.published.map(p => p.variables[0].DefaultValue)).toEqual(['https://demo-assets.b-cdn.net','https://demo-assets.b-cdn.net','https://demo-assets.b-cdn.net']);
    expect(() => target.plan({ project: 'demo', environment: 'dev', revision: 3, artifact: artifact() }, { ...config, variables: { HADARS_ASSET_BASE_URL: 'https://demo-assets.b-cdn.net/revision' } })).toThrow('zone root');
});
const path = (id: string) => `_builds/${id}/client/a.js`;
const record = (id: string, environment: string, revision: number, status: Deployment['status'] = 'superseded'): Deployment => ({ id, environment, revision, status, target: 'bunny', actor: 'mock', startedAt: revision, artifactSummary: { files: 1, bytes: 1 }, staticPaths: [path(id)], staged: { scriptId: id, hostname: 'mock.bunny.run', name: `demo-${environment}-r${revision}`, revision } });
test('GC union protects live, previous, last N per env, previews, existing scripts and in-flight records', () => {
    const records = [record('a','dev',1), record('b','dev',2), record('c','dev',3,'live'), record('d','production',1,'live'), record('e','preview-old',1), record('f','dev',4,'pending')];
    records[2].previousDeploymentId = 'a';
    const scripts = [{ Id: 9, Name: 'demo-preview-old-r1' }]; records[4].staged!.scriptId = '9';
    const objects = [...'abcdef012'].map(id => ({ path: path(id), lastChanged: 0 }));
    objects.push({ path: path('3'), lastChanged: 9_999_999 });
    expect(gcCandidates(records, scripts, 'demo', objects, 3, 10_000_000)).toEqual([path('0'),path('1'),path('2')]);
    expect(() => gcCandidates([{ ...records[2], staticPaths: undefined }], [], 'demo', objects, 0)).toThrow('Missing previous');
    expect(() => gcCandidates([{ ...records[3], staticPaths: undefined }], [], 'demo', objects)).toThrow('legacy');
    expect(() => gcCandidates([], scripts, 'demo', objects)).toThrow('Unrecorded');
    expect(() => gcCandidates([], [], 'demo', [{ path: 'robots.txt', lastChanged: 0 }])).toThrow('unknown');
});
test('directory listing recurses every child, preserves grace; dry-run and unknown prefixes delete nothing', async () => {
    const calls: string[] = [];
    const send = (async (input: any, init: any) => {
        const url = new URL(String(input)); calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
        if (init?.method === 'DELETE') return new Response();
        const directory = (ObjectName: string) => ({ ObjectName, IsDirectory: true });
        const file = (ObjectName: string) => ({ ObjectName, IsDirectory: false, Length: 3, LastChanged: '2020-01-01T00:00:00' });
        const rows: Record<string, any[]> = { '/demo/': [directory('_builds'), directory('unowned'), file('index.abcdef12.js')], '/demo/_builds/': [directory('ab'), directory('cd')], '/demo/_builds/ab/': [directory('client')], '/demo/_builds/cd/': [directory('client')], '/demo/_builds/ab/client/': [file('a.js')], '/demo/_builds/cd/client/': [file('b.js')] };
        if (!rows[url.pathname]) throw new Error('Unexpected directory');
        return Response.json(rows[url.pathname]);
    }) as typeof fetch;
    const objects = await listStaticObjects('demo', 'mock', send);
    expect(objects).toHaveLength(3);
    const candidates = gcCandidates([], [], 'demo', objects);
    await deleteStaticObjects('demo', 'mock', candidates, send);
    expect(calls.some(c => c.startsWith('DELETE'))).toBe(false);
    await expect(deleteStaticObjects('demo', 'mock', ['unowned/a.js'], send, true)).rejects.toThrow('unknown');
    await deleteStaticObjects('demo', 'mock', candidates, send, true);
    expect(calls.filter(c => c.startsWith('DELETE'))).toHaveLength(3);
});

test('explicit GC grace override permits young orphans only and validates grace', () => {
    const objects = [{ path: path('a'), lastChanged: 999 }, { path: path('b'), lastChanged: 1000 }];
    expect(gcCandidates([], [], 'demo', objects, 5, 1000)).toEqual([]);
    expect(gcCandidates([], [], 'demo', objects, 5, 1000, 0)).toEqual([path('a')]);
    for (const grace of [-1, NaN, Infinity]) expect(() => gcCandidates([], [], 'demo', objects, 5, 1000, grace)).toThrow('grace');
});

test('mock storage traverses sibling directories and LastChanged ages; pagination envelopes refuse collection', async () => {
    const mock = mockProvider();
    for (const id of ['ab', 'cd']) mock.objects.set(`/demo/${path(id)}`, bytes(id));
    mock.objects.set('/demo/unmanaged/keep.txt', bytes('keep'));
    mock.changed.set(`/demo/${path('cd')}`, new Date().toISOString());
    const objects = await listStaticObjects('demo', 'mock', mock.send);
    expect(objects.map(o => o.path).sort()).toEqual([path('ab'), path('cd')]);
    expect(gcCandidates([], [], 'demo', objects)).toEqual([path('ab')]);
    expect(mock.storageRequests.some(r => r.url.includes('/unmanaged/'))).toBe(false);
    const paginated = mockProvider({ listingPageSize: 1 });
    paginated.objects.set('/demo/index.abcdef12.js', bytes('a'));
    paginated.objects.set('/demo/index.abcdef13.js', bytes('b'));
    await expect(listStaticObjects('demo', 'mock', paginated.send)).rejects.toThrow('Incomplete storage listing');
    expect(paginated.storageRequests.every(r => r.method === 'GET')).toBe(true);
});

test('shared deploy preserves foreign objects, reports reuse/uploads and refuses exact hashed collisions', async () => {
    const mock = mockProvider();
    const foreign = ['robots.txt', 'old.abcdef12.js', 'about/index.html', 'blog/photo.png', 'discovery/legacy.abcdef12.txt'];
    for (const path of foreign) mock.objects.set(`/demo/${path}`, bytes('foreign'));
    mock.objects.set('/demo/app.abcdef12.js', bytes('same'));
    const input = { project: 'demo', environment: 'dev', revision: 1, artifact: { entry: 'bunny.mjs', files: [{ path: 'bunny.mjs', bytes: bytes('script') }, { path: 'app.abcdef12.js', bytes: bytes('same') }, { path: 'new.abcdef12.js', bytes: bytes('new') }] } };
    const target = new BunnyTarget({ key: 'mock', storageKey: 'mock', storageZone: 'demo', publicZoneId: '1', sharedStorage: true }, mock.send, mock.client);
    const staged = await target.stage(target.plan(input));
    expect(staged.assets).toEqual({ reused: 1, uploaded: 1 });
    for (const path of foreign) expect(mock.objects.get(`/demo/${path}`)).toEqual(bytes('foreign'));
    expect(mock.storageRequests.some(r => r.method === 'DELETE')).toBe(false);
    input.revision = 2; input.artifact.files[1].bytes = bytes('different');
    const before = mock.published.length;
    await expect(target.stage(target.plan(input))).rejects.toThrow('Static asset collision: app.abcdef12.js');
    expect(mock.published).toHaveLength(before);
    expect(mock.objects.get('/demo/app.abcdef12.js')).toEqual(bytes('same'));
});

test('shared GC enforces prefix restriction even for direct candidates/deletion callers', async () => {
    const root = 'index.abcdef12.js', discovery = 'discovery/robots.abcdef12.txt';
    const objects = [root, discovery, path('ab')].map(path => ({ path, lastChanged: 0 }));
    expect(gcCandidates([], [], 'demo', objects, 5, Date.now(), 0, true)).toEqual([path('ab')]);
    let calls = 0;
    const send = (async (_input: any, _init?: any) => { calls++; return new Response(); }) as typeof fetch;
    for (const name of [root, discovery, 'blog/photo.png', 'robots.txt']) await expect(deleteStaticObjects('demo', 'mock', [path('ab'), name], send, true, true)).rejects.toThrow('unknown storage prefixes');
    expect(calls).toBe(0);
    expect(() => gcCandidates([], [{ Id: 42, Name: 'demo-dev-r1-c2' }], 'demo', [], 5, Date.now(), 0, true)).toThrow('Unrecorded');
});
