import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as slimReact from '../src/slim-react/index';
import * as slimJsx from '../src/slim-react/jsx-runtime';
import { provideShared, loadServerModule, loadClientModule, registerModule, getModule, SHARED_GLOBAL, MODULES_GLOBAL } from '../src/composition';
import { buildModule } from '../src/composition/build';

const cwd = join(import.meta.dir, 'fixtures/composition-module');
const out = mkdtempSync(join(tmpdir(), 'hadars-composition-'));
const req = createRequire(import.meta.url);
const extraDirs: string[] = [];
afterAll(() => { for (const d of [out, ...extraDirs]) rmSync(d, { recursive: true, force: true }); });
let result: Awaited<ReturnType<typeof buildModule>>;

beforeAll(async () => {
    result = await buildModule({
        composition: { role: 'module', name: 'greeter', exposes: { greeting: 'src/index.tsx', page: 'src/page.tsx' } },
        cwd,
        outDir: out,
    });
}, 60_000);

test('writes a manifest per target listing the files to load', () => {
    expect(result.server.js).toEqual(['greeter.cjs']);
    expect(result.client.js).toEqual(['greeter.js']);
    expect(JSON.parse(readFileSync(join(out, 'server/manifest.json'), 'utf8'))).toEqual(result.server);
});

test('the server bundle uses the host React, not a private copy', async () => {
    provideShared({
        react: slimReact,
        'react/jsx-runtime': slimJsx,
        'react/jsx-dev-runtime': slimJsx,
    });
    const mod = req(join(out, 'server/greeter.cjs'));
    expect(mod.page.title).toBe('page');
    const { jsx } = slimJsx as any;
    const html = await slimReact.renderToString(
        jsx(mod.greeting.Ctx.Provider, { value: 'host', children: jsx(mod.greeting.Greeting, {}) }),
    );
    expect(html.replace(/<!-- -->/g, '')).toContain('hello host n=2');
});

test('the bundles contain no copy of react', () => {
    for (const f of ['server/greeter.cjs', 'client/greeter.js']) {
        const code = readFileSync(join(out, f), 'utf8');
        expect(code).toContain(SHARED_GLOBAL);
        expect(code).not.toContain('react.element');
    }
    expect(readFileSync(join(out, 'client/greeter.js'), 'utf8')).toContain(MODULES_GLOBAL);
});

test('loadServerModule reads the manifest and loads against the host runtime', async () => {
    provideShared({ react: slimReact, 'react/jsx-runtime': slimJsx, 'react/jsx-dev-runtime': slimJsx });
    const mod = await loadServerModule(join(out, 'server'));
    expect(mod.page.title).toBe('page');
    expect(typeof mod.greeting.Greeting).toBe('function');
});

test('loadServerModule fails clearly when no bundle is listed', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'hadars-composition-empty-'));
    extraDirs.push(empty);
    writeFileSync(join(empty, 'manifest.json'), JSON.stringify({ js: [], css: [] }));
    await expect(loadServerModule(empty)).rejects.toThrow('No server bundle');
});

// Minimal document: records appended elements and fires "load" when each is appended.
const fakeDoc = (onScript: (src: string) => void) => {
    const appended: any[] = [];
    const mk = (tag: string) => {
        const listeners: Record<string, () => void> = {};
        return { tag, addEventListener: (e: string, f: () => void) => { listeners[e] = f; }, listeners } as any;
    };
    return {
        appended,
        createElement: mk,
        querySelector: () => null,
        head: { appendChild: (el: any) => { appended.push(el); if (el.tag === 'script') onScript(el.src); queueMicrotask(() => el.listeners.load?.()); } },
    } as any;
};

test('loadClientModule loads stylesheets before scripts and returns the registered module', async () => {
    delete (globalThis as any)[MODULES_GLOBAL];
    const document = fakeDoc((src) => { (globalThis as any)[MODULES_GLOBAL] = { m1: { src } }; });
    const mod = await loadClientModule('m1', '/w/m1', { manifest: { js: ['m1.js'], css: ['m1.css'] }, document });
    expect(document.appended.map((e: any) => e.tag)).toEqual(['link', 'script']);
    expect(document.appended[0].href).toBe('/w/m1/m1.css');
    expect(mod).toEqual({ src: '/w/m1/m1.js' });
    // second call reuses the registry
    await loadClientModule('m1', '/w/m1', { manifest: { js: ['m1.js'], css: ['m1.css'] }, document });
    expect(document.appended.length).toBe(2);
});

test('loadClientModule rejects when the script does not register the module', async () => {
    delete (globalThis as any)[MODULES_GLOBAL];
    await expect(loadClientModule('ghost', '/g', { manifest: { js: ['g.js'], css: [] }, document: fakeDoc(() => {}) })).rejects.toThrow('did not register');
});

test('the client bundle registers itself and uses the host React when executed', () => {
    const sandbox: any = { [SHARED_GLOBAL]: { react: slimReact, 'react/jsx-runtime': slimJsx, 'react/jsx-dev-runtime': slimJsx } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(readFileSync(join(out, 'client/greeter.js'), 'utf8'), sandbox);
    const mod = sandbox[MODULES_GLOBAL].greeter;
    expect(mod.page.title).toBe('page');
    expect(typeof mod.greeting.Greeting).toBe('function');
});

test('getModule returns what was registered and explains when it was not', () => {
    registerModule('x', { a: 1 });
    expect(getModule<{ a: number }>('x')).toEqual({ a: 1 });
    expect(() => getModule('missing')).toThrow('getInitProps');
});

test('buildModule rejects names and exposes keys that would generate broken output', async () => {
    const base = { cwd, outDir: join(out, 'bad') };
    await expect(buildModule({ ...base, composition: { role: 'module', name: '@scope/x', exposes: { a: 'src/page.tsx' } } })).rejects.toThrow('Invalid module name');
    await expect(buildModule({ ...base, composition: { role: 'module', name: 'ok', exposes: { 'my-page': 'src/page.tsx' } } })).rejects.toThrow('valid JavaScript identifier');
    await expect(buildModule({ ...base, composition: { role: 'module', name: 'ok', exposes: {} } })).rejects.toThrow('exposes nothing');
});

test('loadClientModule runs a module once when called concurrently', async () => {
    delete (globalThis as any)[MODULES_GLOBAL];
    let scripts = 0;
    const document = fakeDoc((src) => { scripts++; (globalThis as any)[MODULES_GLOBAL] = { dup: { src } }; });
    const opts = { manifest: { js: ['d.js'], css: [] }, document };
    const [a, b] = await Promise.all([loadClientModule('dup', '/d', opts), loadClientModule('dup', '/d', opts)]);
    expect(scripts).toBe(1);
    expect(a).toBe(b);
});

test('loadClientModule explains a missing manifest', async () => {
    delete (globalThis as any)[MODULES_GLOBAL];
    const original = globalThis.fetch;
    (globalThis as any).fetch = async () => new Response('nope', { status: 404 });
    try {
        await expect(loadClientModule('gone', '/gone', { document: fakeDoc(() => {}) })).rejects.toThrow('Could not load the manifest for module "gone" (404');
    } finally {
        globalThis.fetch = original;
    }
});

test('crossOrigin is only set when asked for', async () => {
    delete (globalThis as any)[MODULES_GLOBAL];
    const seen: any[] = [];
    const document = fakeDoc((src) => { (globalThis as any)[MODULES_GLOBAL] = { co: {} }; });
    const append = document.head.appendChild;
    document.head.appendChild = (el: any) => { seen.push(el.crossOrigin); return append(el); };
    await loadClientModule('co', '/co', { manifest: { js: ['c.js'], css: [] }, document });
    delete (globalThis as any)[MODULES_GLOBAL];
    await loadClientModule('co', '/co', { manifest: { js: ['c.js'], css: [] }, document, crossOrigin: 'anonymous' });
    expect(seen).toEqual([undefined, 'anonymous']);
});

test('loadServerModule rides out a bundle caught half written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hadars-composition-partial-'));
    extraDirs.push(dir);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ js: ['p.cjs'], css: [] }));
    writeFileSync(join(dir, 'p.cjs'), 'module.exports = {');
    setTimeout(() => writeFileSync(join(dir, 'p.cjs'), 'module.exports = { ok: true };'), 80);
    expect(await loadServerModule(dir)).toEqual({ ok: true });
});

test('loadServerModule does not hide a real syntax error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hadars-composition-broken-'));
    extraDirs.push(dir);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ js: ['b.cjs'], css: [] }));
    writeFileSync(join(dir, 'b.cjs'), 'module.exports = {');
    await expect(loadServerModule(dir)).rejects.toThrow();
});

test('client loader applies SRI to scripts and styles only for mapped files', async () => {
    delete (globalThis as any)[MODULES_GLOBAL];
    const document = fakeDoc(() => { (globalThis as any)[MODULES_GLOBAL] = { sri: {} }; });
    await loadClientModule('sri', '/build', { manifest: { js: ['signed.js', 'plain.js'], css: ['signed.css', 'plain.css'] },
        integrity: { 'signed.js': 'sha256-script', 'signed.css': 'sha256-style' }, document });
    expect(document.appended.map((el: any) => [el.integrity, el.crossOrigin])).toEqual([
        ['sha256-style', 'anonymous'], [undefined, undefined], ['sha256-script', 'anonymous'], [undefined, undefined],
    ]);
});


test('client loader encodes artifact paths without changing integrity map keys', async () => {
    delete (globalThis as any)[MODULES_GLOBAL];
    const document = fakeDoc(() => { (globalThis as any)[MODULES_GLOBAL] = { encoded: {} }; });
    await loadClientModule('encoded', '/build', { manifest: { js: ['client/file #.js'], css: [] },
        integrity: { 'client/file #.js': 'sha256-script' }, document });
    expect(document.appended[0].src).toBe('/build/client/file%20%23.js');
    expect(document.appended[0].integrity).toBe('sha256-script');
});
