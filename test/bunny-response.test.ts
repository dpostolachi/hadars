import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBunnyHandler } from '../src/bunny';
import type { HadarsOptions } from '../src/types/hadars';

const bundled = { ssrModule: { default: () => null }, outHtml: '<head><meta name="HADARS_HEAD"></head><meta name="HADARS_BODY">' };

test('Bunny response hook handles fetch responses asynchronously without consuming the body', async () => {
    const req = new Request('https://example.test/api');
    const handler = createBunnyHandler({ entry: '', fetch: () => new Response('stream', { status: 201 }),
        onResponse: async (res, request, startedAt) => {
            expect(request).toBe(req);
            expect(startedAt).toBeLessThanOrEqual(performance.now());
            await Promise.resolve();
            res.headers.set('cache-control', 'private, no-store');
        },
    }, bundled);
    const res = await handler(req);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe('stream');
});

test('Bunny response hook replaces SSR, data-only, proxy and render-error responses', async () => {
    for (const mode of ['html', 'data', 'proxy', 'error']) {
        const options: HadarsOptions = { entry: '', onResponse: (res) => new Response(res.body, { status: res.status, headers: { 'x-hook': mode } }) };
        if (mode === 'proxy') options.proxy = () => new Response('proxied');
        const app = mode === 'error' ? { ...bundled, ssrModule: { default: () => null, getInitProps: () => { throw new Error('expected'); } } } : bundled;
        const res = await createBunnyHandler(options, app)(new Request('https://example.test/', { headers: mode === 'data' ? { accept: 'application/json' } : {} }));
        expect(res.headers.get('x-hook')).toBe(mode);
        expect(res.status).toBe(mode === 'error' ? 500 : 200);
        await res.text();
    }
});

test('Bunny response hook runs for cache hits and preserves exports without a hook', async () => {
    let rendered = 0;
    let hooks = 0;
    const handler = createBunnyHandler({ entry: '', cache: () => ({ key: 'same' }), fetch: () => new Response(String(++rendered)), onResponse: () => { hooks++; } }, bundled);
    for (let i = 0; i < 2; i++) await (await handler(new Request('https://example.test/'))).text();
    expect(rendered).toBe(1);
    expect(hooks).toBe(2);
    const plain = await createBunnyHandler({ entry: '', fetch: () => new Response('plain') }, bundled)(new Request('https://example.test/'));
    expect(await plain.text()).toBe('plain');
});


test('Bunny export preserves the configured response hook in the generated handler', async () => {
    const root = join(import.meta.dir, '..');
    const dir = mkdtempSync(join(tmpdir(), 'hadars-bunny-hook-'));
    try {
        symlinkSync(join(root, 'test/fixtures/composition-shell/node_modules'), join(dir, 'node_modules'), 'dir');
        writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'bundler' } }));
        writeFileSync(join(dir, 'App.tsx'), 'export default function App() { return null; }');
        writeFileSync(join(dir, 'hadars.config.ts'), `export default {
            entry: 'App.tsx', fetch: () => new Response('exported body'),
            onResponse: (response: Response) => { response.headers.set('x-response-hook', 'exported'); },
        };`);
        const output = join(dir, 'bunny.mjs');
        const child = Bun.spawn([process.execPath, join(root, 'dist/cli.js'), 'export', 'bunny', output], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
        const [status, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
        if (status !== 0) throw new Error(stdout + stderr);
        // The SDK registration is provided by the runtime; capture it locally for this test.
        writeFileSync(join(dir, 'sdk.mjs'), 'export const net = { http: { serve(handler) { globalThis.__hadarsExportHandler = handler; } } };');
        writeFileSync(output, readFileSync(output, 'utf8').replaceAll('"@bunny.net/edgescript-sdk"', '"./sdk.mjs"'));
        await import(output);
        const response = await (globalThis as any).__hadarsExportHandler(new Request('https://example.test/'));
        expect(response.headers.get('x-response-hook')).toBe('exported');
        expect(await response.text()).toBe('exported body');
    } finally {
        delete (globalThis as any).__hadarsExportHandler;
        rmSync(dir, { recursive: true, force: true });
    }
}, 60_000);
