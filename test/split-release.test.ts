import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { splitHandler } from '../src/composition/splitRuntime';
import splitClientLoader from '../src/utils/splitClientLoader';
import { gzipCompress } from '../src/utils/ssrHandler';
const root = join(import.meta.dir, '..');
const identity = { release: '0123456789abcdef', group: 'main', shell: 'shell' };
const old = 'fedcba9876543210';

test('selector gate precedes handlers on every method; probe bypasses it; all responses identify the unit', async () => {
    let calls = 0;
    const handler = splitHandler(async () => { calls++; return new Response('ok'); }, identity);
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        for (const selector of [undefined, identity.release, old, '', '0123456789ABCDEf', '../origin']) {
            const before = calls;
            const response = await handler(new Request('http://local/api', { method, headers: selector === undefined ? {} : { 'x-hadars-release-selector': selector } }));
            const valid = selector === undefined || selector === identity.release;
            const mismatch = selector === old;
            expect(calls - before).toBe(valid ? 1 : 0);
            expect(response.status).toBe(valid ? 200 : mismatch ? 409 : 400);
            expect(response.headers.get('x-hadars-release')).toBe(identity.release);
            expect(response.headers.get('x-hadars-group')).toBe(identity.group);
            if (!valid) {
                expect(response.headers.get('content-type')).toBe('application/json');
                expect(response.headers.get('cache-control')).toBe('no-store');
                expect(await response.text()).toBe(JSON.stringify(mismatch ? { error: 'SPLIT_RELEASE_MISMATCH', expected: identity.release, received: old, group: 'main' } : { error: 'SPLIT_RELEASE_SELECTOR_INVALID' }));
            }
        }
    }
    const before = calls;
    for (const selector of [old, 'invalid']) {
        const probe = await handler(new Request('http://local/__hadars/release?x', { headers: { 'x-hadars-release-selector': selector } }));
        expect(await probe.json()).toEqual(identity);
        expect(probe.headers.get('x-hadars-release')).toBe(identity.release);
    }
    expect(calls).toBe(before);
});

test('HTML global appears once before entry scripts, across stream boundaries and cached gzip', async () => {
    const html = '<!doctype html><html><head><script src="entry.js"></script></head><body>é🦊</body></html>';
    for (const compressed of [false, true]) {
        const bytes = compressed ? await gzipCompress(new TextEncoder().encode(html)) : new TextEncoder().encode(html);
        const handler = splitHandler(async () => new Response(new ReadableStream({ start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
            controller.close();
        } }), { headers: { 'content-type': 'text/html; charset=utf-8', ...(compressed ? { 'content-encoding': 'gzip' } : {}) } }), identity);
        const response = await handler(new Request('http://local/'));
        const result = await response.text();
        expect(result.split('__HADARS_RELEASE__').length).toBe(2);
        expect(result).toContain('globalThis.__HADARS_RELEASE__ = {"release":"0123456789abcdef","group":"main"}');
        expect(result.indexOf('__HADARS_RELEASE__')).toBeLessThan(result.indexOf('src="entry.js"'));
        expect(result).toContain('é🦊');
        expect(response.headers.has('content-encoding')).toBe(false);
    }
});

test('executable document JSON escapes script terminators', async () => {
    const handler = splitHandler(async () => new Response('<head></head>', { headers: { 'content-type': 'text/html' } }), { ...identity, group: '</script>' });
    const html = await (await handler(new Request('http://local/'))).text();
    expect(html).toContain('\\u003c/script>');
});

test('split-only client transform recognizes distributed and source data requests', () => {
    for (const file of ['src/utils/Head.tsx', ...new Bun.Glob('dist/chunk-*.js').scanSync(root)]) {
        const source = readFileSync(join(root, file), 'utf8');
        const result = splitClientLoader.call({ getOptions: () => ({ runtime: '/runtime.js' }) }, source);
        if (source.includes('fetch(pathKey,')) {
            expect(result).toContain('__releaseFetch(pathKey,');
            expect(result).toContain('reject(error)');
        } else expect(result).toBe(source);
    }
});

for (const storageThrows of [false, true]) test(`client reload once, typed failure, no POST replay; storage throws=${storageThrows}`, async () => {
    const originals = Object.fromEntries(['fetch', 'location', 'sessionStorage', '__HADARS_RELEASE__'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const originalError = console.error;
    const values = new Map<string, string>();
    const navigations: string[] = [];
    let fetches = 0, logs = 0;
    try {
        const client = await import(`../src/utils/releaseClient.ts?case=${storageThrows}`);
        Object.defineProperty(globalThis, '__HADARS_RELEASE__', { configurable: true, value: { release: old } });
        Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'http://local/', assign: (url: string) => navigations.push(url) } });
        Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
            getItem: (key: string) => { if (storageThrows) throw Error('unavailable'); return values.get(key) ?? null; },
            setItem: (key: string, value: string) => { if (storageThrows) throw Error('unavailable'); values.set(key, value); },
        } });
        console.error = () => { logs++; };
        globalThis.fetch = (async (_url, init) => {
            fetches++;
            expect(new Headers(init?.headers).get('x-hadars-release-selector')).toBe(old);
            return new Response(JSON.stringify({ error: 'SPLIT_RELEASE_MISMATCH', expected: identity.release, received: old, group: 'main' }), { status: 409 });
        }) as typeof fetch;
        expect(client.getReleaseRequestHeaders()).toEqual({ 'x-hadars-release-selector': old });
        if (!storageThrows) values.set('hadars-release-reload', JSON.stringify({ target: 'http://local/target?x=1', timestamp: Date.now() - 31_000 }));
        void client.releaseFetch('/target?x=1');
        for (let i = 0; i < 50 && !navigations.length; i++) await Bun.sleep(1);
        expect(navigations).toEqual(['http://local/target?x=1']);
        if (!storageThrows) expect(JSON.parse(values.get('hadars-release-reload')!)).toMatchObject({ target: navigations[0] });
        for (let i = 0; i < 2; i++) {
            try { await client.releaseFetch('/target?x=1'); throw Error('expected rejection'); } catch (error) {
                expect(error).toBeInstanceOf(client.SplitReleaseMismatchError);
                expect(error).toMatchObject({ expected: identity.release, received: old, group: 'main' });
            }
        }
        expect(logs).toBe(1);
        await expect(client.releaseFetch('/mutation', { method: 'POST' })).rejects.toBeInstanceOf(client.SplitReleaseMismatchError);
        expect(navigations.length).toBe(1);
        expect(fetches).toBe(4);
        delete (globalThis as any).__HADARS_RELEASE__;
        expect(client.getReleaseRequestHeaders()).toEqual({});
    } finally {
        console.error = originalError;
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
        }
    }
});

test('two live releases reject old data selectors and reload into the current document', async () => {
    const { chromium } = await import('playwright');
    const { build } = await import('esbuild');
    const script = await build({ stdin: { contents: `import { releaseFetch } from './src/utils/releaseClient'; globalThis.navigate = () => releaseFetch('/next', {headers: {Accept: 'application/json'}});`, resolveDir: root }, bundle: true, write: false, format: 'iife', platform: 'browser' });
    const html = '<!doctype html><html><head><script src="/client.js"></script></head><body>release document</body></html>';
    let dataRequests = 0, documents = 0;
    const runtime = await build({ stdin: { contents: `export { splitHandler } from './src/composition/splitRuntime';`, resolveDir: root },
        bundle: true, write: false, format: 'esm', platform: 'browser', minify: true, legalComments: 'none', sourcemap: false });
    const { splitHandler: minifiedHandler } = await import('data:text/javascript;base64,' + Buffer.from(runtime.outputFiles[0]!.text).toString('base64'));
    const makeUnit = (release: string) => minifiedHandler(async request => {
        if (request.headers.get('accept') === 'application/json') { dataRequests++; return Response.json({ serverData: {} }); }
        documents++;
        return new Response(html, { headers: { 'content-type': 'text/html' } });
    }, { ...identity, release });
    const previous = makeUnit(old), current = makeUnit(identity.release);
    let activated = false;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
        if (new URL(request.url).pathname === '/client.js') return new Response(script.outputFiles[0]!.text, { headers: { 'content-type': 'application/javascript' } });
        return (activated ? current : previous)(request);
    } });
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.goto(server.url.href);
        expect(await page.evaluate(() => (globalThis as any).__HADARS_RELEASE__.release)).toBe(old);
        activated = true;
        const rejected = await fetch(new URL('/next', server.url), { headers: { Accept: 'application/json', 'x-hadars-release-selector': old } });
        expect(await rejected.json()).toEqual({ error: 'SPLIT_RELEASE_MISMATCH', expected: identity.release, received: old, group: 'main' });
        const mismatch = page.waitForResponse(response => response.status() === 409);
        await page.evaluate(() => { void (globalThis as any).navigate(); });
        expect((await mismatch).headers()['x-hadars-release']).toBe(identity.release);
        await page.waitForURL('**/next');
        await page.waitForLoadState();
        expect(await page.evaluate(() => (globalThis as any).__HADARS_RELEASE__.release)).toBe(identity.release);
        expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hadars-release-reload')!).target)).toBe(new URL('/next', server.url).href);
        expect(dataRequests).toBe(0);
        expect(documents).toBe(2);
        expect(await page.evaluate(async () => (await (globalThis as any).navigate()).status)).toBe(200);
        expect(dataRequests).toBe(1);
        expect(documents).toBe(2);
    } finally { await browser.close(); await server.stop(true); }
});
