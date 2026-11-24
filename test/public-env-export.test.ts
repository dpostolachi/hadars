import { expect, test } from 'bun:test';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Bundle the real binding adapter so compile-time transforms cannot mask runtime reads.
test('bundled edge handler isolates public binding values in SSR and cached HTML', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'public-env-export-'));
    try {
        const file = join(dir, 'handler.mjs');
        const template = '<html><head><script src="/entry.js"></script><meta name="HADARS_HEAD"></head><body><meta name="HADARS_BODY"></body></html>';
        await build({ stdin: { contents: `
            import { createCloudflareHandler as createHandler } from ${JSON.stringify(join(import.meta.dir, '../src/cloudflare.ts'))};
            import { getPublicEnv } from ${JSON.stringify(join(import.meta.dir, '../src/utils/publicEnv.ts'))};
            import React from 'react';
            export default createHandler({ entry: 'unused', cache: () => ({ key: 'same-page' }) }, {
                ssrModule: { default: () => React.createElement('p', null, getPublicEnv('HADARS_PUBLIC_CLIENT_ID', 'built')) },
                outHtml: ${JSON.stringify(template)}
            });`, resolveDir: import.meta.dir, loader: 'ts' }, outfile: file,
            bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
            define: { global: 'globalThis', __EDGE_RUNTIME__: 'true' } });
        expect(await readFile(file, 'utf8')).not.toMatch(/["'`]node:[^"'`]+["'`]/);
        const { default: handler } = await import(file);
        const values = ['first', 'second', undefined, ''];
        const html = await Promise.all(values.map(async value => {
            const response = await handler.fetch(new Request('https://example.test/'), {
                HADARS_PUBLIC_CLIENT_ID: value, SECRET_TOKEN: 'must-stay-private', HADARS_APP_ID: 'also-private',
            }, {});
            expect(response.status).toBe(200);
            return response.text();
        }));
        for (let i = 0; i < values.length; i++) {
            expect(html[i]).toContain(`<p>${values[i] ?? 'built'}</p>`);
            expect(html[i]).not.toContain('must-stay-private');
            expect(html[i]).not.toContain('also-private');
        }
        expect(html[0]).toContain('"HADARS_PUBLIC_CLIENT_ID":"first"');
        expect(html[1]).toContain('"HADARS_PUBLIC_CLIENT_ID":"second"');
        expect(html[2]).not.toContain('"HADARS_PUBLIC_CLIENT_ID"');
    } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);

test('compiled client helper prefers injected values over a defined build-time fallback', async () => {
    const { runInNewContext } = await import('node:vm');
    const result = await build({ stdin: { contents: `
        import { getPublicEnv } from ${JSON.stringify(join(import.meta.dir, '../src/utils/publicEnv.ts'))};
        globalThis.result = getPublicEnv('HADARS_PUBLIC_CLIENT_ID', process.env.HADARS_APP_CLIENT_ID);
    `, resolveDir: import.meta.dir, loader: 'ts' }, bundle: true, platform: 'browser', format: 'iife', write: false,
        define: { 'process.env.HADARS_APP_CLIENT_ID': JSON.stringify('built') } });
    const code = result.outputFiles[0]!.text;
    for (const value of ['deployed', '', undefined]) {
        const context = { TextEncoder, document: {}, __HADARS_PUBLIC_ENV__: value === undefined ? {} : { HADARS_PUBLIC_CLIENT_ID: value }, result: undefined };
        runInNewContext(code, context);
        expect(context.result).toBe(value ?? 'built');
    }
});
