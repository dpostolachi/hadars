import { afterAll, expect, test } from 'bun:test';
import { runtimeConfigSource } from '../src/utils/exportConfig';

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'runtime-config-'));
let sequence = 0;
afterAll(() => rmSync(dir, { recursive: true, force: true }));
async function evaluate(code: string) {
    const file = join(dir, `${sequence++}.mjs`);
    writeFileSync(file, code);
    return (await import(file)).default;
}
async function load(source: string) {
    const code = await runtimeConfigSource(source, 'config.ts');
    return { code, config: await evaluate(code) };
}

test('runtime config keeps closures and shadowed bindings, not eager compiler dependencies', async () => {
    const { code, config } = await load(`import Plugin from 'build-only-package';
        const plugin = new Plugin(), message = 'runtime';
        const options = { plugins: [plugin], moduleRules: [{ use: 'build-only-loader' }],
            fetch: () => { const plugin = 'local'; return new Response(message + plugin); } };
        export default { ...options, onResponse: response => response };`);
    expect(code).not.toContain('build-only');
    expect(code).not.toContain('new Plugin');
    expect(await config.fetch().text()).toBe('runtimelocal');
});

test('runtime config retains actual runtime imports and all handler options', async () => {
    const code = await runtimeConfigSource(`import { basename } from 'node:path';
        export default { entry: 'app.tsx', proxy: {'/api': 'https://example.test'}, proxyCORS: true,
            cache: req => ({ key: req.url }), onError: console.error, onResponse: r => r,
            fetch: () => new Response(basename('/runtime/file')) };`, 'config.ts');
    expect(code).toContain('node:path');
    const config = await evaluate(code);
    expect(await config.fetch().text()).toBe('file');
    expect(Object.keys(config).sort()).toEqual(['proxy', 'proxyCORS', 'cache', 'onError', 'onResponse', 'fetch'].sort());
});

test('dynamic config needs an explicit declarative runtime object', async () => {
    await expect(runtimeConfigSource(`export default createConfig();`, 'config.ts')).rejects.toThrow('Cannot isolate runtime config');
    const { code, config } = await load(`import createConfig from 'build-only-package';
        export const runtimeConfig = { fetch: () => new Response('explicit') };
        export default createConfig(runtimeConfig);`);
    expect(code).not.toContain('build-only');
    expect(await config.fetch().text()).toBe('explicit');
});

test('imperative config changes and imported spreads cannot silently change runtime behavior', async () => {
    for (const source of [
        `const config = { fetch: () => new Response('before') }; config.fetch = () => new Response('after'); export default config;`,
        `import config from './other'; export default { ...config };`,
        `import './initialize'; export default {};`,
    ]) await expect(runtimeConfigSource(source, 'config.ts')).rejects.toThrow('Cannot isolate runtime config');
});

test('a declarative commonjs config uses the same runtime boundary', async () => {
    const code = await runtimeConfigSource(`const plugin = require('build-only-package');
        module.exports = { plugins: [plugin], fetch: () => new Response('commonjs') };`, 'config.cjs');
    expect(code).not.toContain('build-only');
    expect(await (await evaluate(code)).fetch().text()).toBe('commonjs');
});

test('destructuring defaults retain their dependencies and helper functions', async () => {
    const { config } = await load(`const fallback = 'runtime';
        const { value = fallback } = {};
        function message() { return value; }
        export default { fetch() { return new Response(message()); } };`);
    expect(await config.fetch().text()).toBe('runtime');
});

test('script exports select production dependencies explicitly, with a readable legacy escape hatch', async () => {
    const { build } = await import('esbuild');
    const { exportScriptOptions } = await import('../src/utils/exportScript');
    const production = exportScriptOptions('1');
    const debug = exportScriptOptions('0');
    // Disable compression independently to prove selection comes from the explicit define.
    for (const options of [production, { ...production, minify: false }, debug]) {
        const result = await build({ stdin: { contents: `
            /*! @license fixture license */
            export default process.env.NODE_ENV === 'production' ? 'production-marker' : 'development-marker';
            export const runtime = [global, __EDGE_RUNTIME__];`, sourcefile: 'script.ts' },
            bundle: true, write: false, platform: 'browser', format: 'esm', ...options });
        const source = result.outputFiles[0]!.text;
        expect(await evaluate(source)).toBe(options === debug ? 'development-marker' : 'production-marker');
        if (options.minify) expect(source).not.toContain('development-marker');
        expect(source).not.toContain('fixture license');
        expect(source).not.toContain('sourceMappingURL');
        expect(result.outputFiles).toHaveLength(1);
        expect(source).toContain('globalThis');
    }
});
