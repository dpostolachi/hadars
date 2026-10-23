import { test, expect, beforeAll } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as slimReact from '../src/slim-react/index';
import * as slimJsx from '../src/slim-react/jsx-runtime';
import { provideShared, loadServerModule, loadClientModule, registerModule, useModule, SHARED_GLOBAL, MODULES_GLOBAL } from '../src/composition';
import { buildModule } from '../src/composition/build';

const cwd = join(import.meta.dir, 'fixtures/composition-module');
const out = mkdtempSync(join(tmpdir(), 'hadars-composition-'));
const req = createRequire(import.meta.url);
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
    const doc = fakeDoc((src) => { (globalThis as any)[MODULES_GLOBAL] = { m1: { src } }; });
    const mod = await loadClientModule('m1', '/w/m1', { js: ['m1.js'], css: ['m1.css'] }, doc);
    expect(doc.appended.map((e: any) => e.tag)).toEqual(['link', 'script']);
    expect(doc.appended[0].href).toBe('/w/m1/m1.css');
    expect(mod).toEqual({ src: '/w/m1/m1.js' });
    // second call reuses the registry
    await loadClientModule('m1', '/w/m1', { js: ['m1.js'], css: ['m1.css'] }, doc);
    expect(doc.appended.length).toBe(2);
});

test('loadClientModule rejects when the script does not register the module', async () => {
    delete (globalThis as any)[MODULES_GLOBAL];
    await expect(loadClientModule('ghost', '/g', { js: ['g.js'], css: [] }, fakeDoc(() => {}))).rejects.toThrow('did not register');
});

test('the client bundle registers itself and uses the host React when executed', () => {
    const sandbox: any = { [SHARED_GLOBAL]: { react: slimReact, 'react/jsx-runtime': slimJsx, 'react/jsx-dev-runtime': slimJsx } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(readFileSync(join(out, 'client/greeter.js'), 'utf8'), sandbox);
    const mod = sandbox[MODULES_GLOBAL].greeter;
    expect(mod.page.title).toBe('page');
    expect(typeof mod.greeting.Greeting).toBe('function');
});

test('useModule returns what was registered and explains when it was not', () => {
    registerModule('x', { a: 1 });
    expect(useModule<{ a: number }>('x')).toEqual({ a: 1 });
    expect(() => useModule('missing')).toThrow('getInitProps');
});
