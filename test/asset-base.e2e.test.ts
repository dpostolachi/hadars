import { expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { rspack } from '@rspack/core';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeAssetsPlugin } from '../src/utils/runtimeAssetsPlugin';
import { buildSsrHtml, makePrecontentHtmlGetter } from '../src/utils/ssrHandler';

test('a compiled client loads entry assets and lazy chunks from the deployment base', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-assets-'));
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
        await writeFile(join(dir, 'entry.js'), `import './style.css'; globalThis.loadLazy = () => import('./lazy.js').then(m => m.default);`);
        await writeFile(join(dir, 'lazy.js'), `import './lazy.css'; export default 'loaded';`);
        await writeFile(join(dir, 'style.css'), 'body { color: rgb(1, 2, 3); }');
        await writeFile(join(dir, 'lazy.css'), 'body { background-color: rgb(4, 5, 6); }');
        await writeFile(join(dir, 'template.html'), '<html><head><meta name="HADARS_HEAD"></head><body><meta name="HADARS_BODY"></body></html>');
        const built = 'https://built.example/assets/';
        await new Promise<void>((resolve, reject) => {
            const compiler = rspack({ mode: 'production', context: dir, target: 'web', entry: './entry.js',
                experiments: { css: true }, output: { path: join(dir, 'out'), filename: 'entry.[contenthash].js', publicPath: built },
                module: { rules: [{ test: /\.css$/, type: 'css' }] },
                plugins: [new RuntimeAssetsPlugin(built), new rspack.HtmlRspackPlugin({
                    template: join(dir, 'template.html'), filename: 'out.html', publicPath: built, scriptLoading: 'module', minify: true,
                })] });
            compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
                ? reject(error ?? new Error(stats?.toString())) : resolve()));
        });
        const template = await readFile(join(dir, 'out/out.html'), 'utf8');
        expect(template).toContain('HADARS_ASSET_BASE');
        browser = await chromium.launch({ headless: true });
        // Exercise the same compiled bytes with each deployment setting.
        for (const base of [undefined, 'https://runtime.example/preview/', '/preview/']) {
            const html = await buildSsrHtml('', {}, '', makePrecontentHtmlGetter(Promise.resolve(template), () => base));
            const page = await browser.newPage();
            const assets: string[] = [];
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.href === 'https://shell.example/') return route.fulfill({ contentType: 'text/html', body: html });
                assets.push(url.href);
                const file = url.pathname.split('/').pop()!;
                const body = await readFile(join(dir, 'out', file));
                return route.fulfill({ body, contentType: file.endsWith('.css') ? 'text/css' : 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
            });
            await page.goto('https://shell.example/');
            expect(await page.evaluate(() => (globalThis as any).loadLazy())).toBe('loaded');
            expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(4, 5, 6)');
            expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe('rgb(1, 2, 3)');
            const expected = base === undefined ? built : new URL(base, 'https://shell.example/').href;
            expect(assets.length).toBe(4);
            expect(assets.every(url => url.startsWith(expected))).toBe(true);
            await page.close();
        }
    } finally {
        await browser?.close();
        await rm(dir, { recursive: true, force: true });
    }
}, 60_000);

test('a bundled edge export reads deployment bindings after bundling', async () => {
    const { build } = await import('esbuild');
    const dir = await mkdtemp(join(tmpdir(), 'runtime-export-'));
    try {
        const entry = join(import.meta.dir, '../src/cloudflare.ts');
        const metadata = encodeURIComponent(JSON.stringify({ base: 'https://built.example', files: ['entry.hash.js'] }));
        const html = `<html><head><meta name="HADARS_ASSET_BASE" content="${metadata}"><script src="https://built.example/entry.hash.js"></script><meta name="HADARS_HEAD"></head><body><meta name="HADARS_BODY"></body></html>`;
        const file = join(dir, 'handler.mjs');
        await build({ stdin: { contents: `import { createCloudflareHandler } from ${JSON.stringify(entry)};
            import React from 'react';
            import { ModuleHead } from ${JSON.stringify(join(import.meta.dir, '../src/composition/ModuleHead.ts'))};
            export default createCloudflareHandler({ entry: 'unused' }, {
                ssrModule: { default: ({ client }) => React.createElement(ModuleHead, { client }),
                    getInitProps: request => ({ client: request.pinnedClients.module }) }, outHtml: ${JSON.stringify(html)},
                pinnedClients: { module: { baseUrl: '/_builds/id/', manifest: { js: ['module.js'], css: [] }, integrity: { 'module.js': 'sha256-test' } } }
            });`, resolveDir: import.meta.dir, loader: 'ts' }, outfile: file,
            bundle: true, platform: 'browser', format: 'esm', target: 'es2022', define: { global: 'globalThis', __EDGE_RUNTIME__: 'true' } });
        expect(await readFile(file, 'utf8')).not.toMatch(/["'`]node:[^"'`]+["'`]/);
        const { default: handler } = await import(file);
        const response = await handler.fetch(new Request('https://shell.example/'), { HADARS_ASSET_BASE_URL: 'https://deployed.example/assets/' }, {});
        expect(response.status).toBe(200);
        const rendered = await response.text();
        expect(rendered).toContain('src="https://deployed.example/assets/entry.hash.js"');
        expect(rendered).toContain('globalThis.__HADARS_ASSET_BASE_URL__="https://deployed.example/assets"');
        expect(rendered).toContain('src="https://deployed.example/assets/_builds/id/module.js"');
        expect(rendered).toContain('integrity="sha256-test"');
        expect(rendered).toContain('"baseUrl":"https://deployed.example/assets/_builds/id/"');
    } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);
