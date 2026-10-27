import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readdirSync, openSync, closeSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createBuild, assembleLockfile, verifyExport } from '../src/composition/build';
import { pinExportShell } from '../src/composition/exportShell';
import { hash } from '../src/composition/identity';
const root = join(import.meta.dir, '..');
const dir = mkdtempSync(join(root, '.split-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function write(file: string, data: string) { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, data); }
const spec = { mode: 'per-module', defaultGroup: 'main', mounts: { admin: ['/admin/**'], shop: ['/shop/**'] }, budgets: { unitBytes: 9_000_000 } };
function config(split?: any, label = 'export') {
    write(join(dir, 'hadars.config.ts'), `export default { entry: 'App.tsx', define: { __BUILD_LABEL__: ${JSON.stringify(JSON.stringify(label))} }, port: Number(process.env.PORT || 9090), composition: { role: 'shell', name: 'shell', pinned: { lockFile: 'lock.json', buildsDir: 'builds' } }, ${split ? `split: ${JSON.stringify(split)},` : ''} fetch: req => req.pathname.startsWith('/document') ? undefined : new Response('hook'), onResponse: r => r };`);
}
let invocation = 0;
async function cli(...args: string[]) {
    const log = join(dir, `cli-${invocation++}.log`);
    const fd = openSync(log, 'w');
    try {
        const child = Bun.spawn(['node', '--import', join(dir, 'node-runtime.mjs'), join(root, 'dist/cli.js'), ...args], { cwd: dir, stdout: fd, stderr: fd });
        const code = await child.exited;
        const stdout = readFileSync(log, 'utf8');
        if (code) throw new Error(stdout);
        return stdout;
    } finally { closeSync(fd); }
}
test('composed split export: isolation, final hashes, probes, budgets and complete seal', async () => {
    // A fixed clock stabilizes legacy temporary filenames embedded in bundle comments.
    write(join(dir, 'node-runtime.mjs'), 'globalThis.Deno = { version: { deno: "test" } }; Date.now = () => 1700000000000;');
    mkdirSync(join(dir, 'node_modules'));
    for (const name of readdirSync(join(root, 'node_modules'))) if (name !== 'hadars') symlinkSync(join(root, 'node_modules', name), join(dir, 'node_modules', name), 'dir');
    symlinkSync(root, join(dir, 'node_modules/hadars'), 'dir');
    write(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', target: 'ES2022', module: 'ESNext' } }));
    write(join(dir, 'App.tsx'), `import React from 'react'; import { useServerData } from 'hadars'; export default () => { const data = useServerData(() => 'data'); return <main>{__BUILD_LABEL__}{data}</main>; };`);
    const targets = { client: { js: ['client/entry.js'], css: [] }, server: { js: ['server/entry.cjs'], css: [] } };
    const pins = ['shell', 'admin', 'shop'].map(name => {
        const source = join(dir, 'sources', name);
        write(join(source, 'client/entry.js'), `globalThis.${name}Client = true;`);
        write(join(source, 'server/entry.cjs'), `module.exports = { marker: '${name.toUpperCase()}_SERVER_MARKER' };`);
        return createBuild({ sourceDir: source, buildsDir: join(dir, 'builds'), kind: name === 'shell' ? 'shell' : 'module', name, exposes: name === 'shell' ? [] : ['page'], targets }).manifest;
    });
    write(join(dir, 'lock.json'), JSON.stringify(assembleLockfile({ shell: pins[0]!, modules: pins.slice(1) })));
    config(undefined, 'earlier');
    await cli('build');
    const earlier = pinExportShell(dir, JSON.parse(readFileSync(join(dir, 'lock.json'), 'utf8')), join(dir, 'builds'), false).lock;
    write(join(dir, 'lock.json'), JSON.stringify(earlier));
    config({ ...spec, budgets: undefined });
    const logs = await cli('export', 'bunny');
    console.log(logs.match(/Shared shell build:.*|Unit .*|Split units bundled.*/g)?.join('\n'));
    expect(logs.match(/Shared shell build:/g)?.length).toBe(1);
    const clientScripts = readdirSync(join(dir, '.hadars/static')).filter(f => f.endsWith('.js'))
        .map(f => readFileSync(join(dir, '.hadars/static', f), 'utf8')).join('\n');
    expect(clientScripts.includes('hadars-release-reload')).toBe(true);
    expect(clientScripts.includes('x-hadars-release-selector')).toBe(true);
    const metadata = '.hadars/static/composition-provenance.json';
    const manifestPath = join(dir, '.hadars/split-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(JSON.stringify(manifest)).not.toContain(dir);
    expect(manifest.shell).not.toBe(earlier.snapshot.shell);
    expect(manifest.snapshot).not.toBe(earlier.snapshotId);
    const earlierClients = earlier.builds[earlier.snapshot.shell]!.manifest.targets.client.js;
    expect(earlierClients.some((file: string) => !existsSync(join(dir, '.hadars/static', file.slice(7))))).toBe(true);
    const finalLock = JSON.parse(readFileSync(join(dir, 'hadars.lock'), 'utf8'));
    expect(finalLock.snapshot.modules).toEqual(earlier.snapshot.modules);
    expect(finalLock.snapshotId).toBe(manifest.snapshot);
    const linked = JSON.parse(readFileSync(join(dir, metadata), 'utf8'));
    for (const name of ['admin', 'shop']) {
        expect(linked.modules[name].buildId).toBe(finalLock.snapshot.modules[name]);
        expect(linked.modules[name].server).toEqual(finalLock.builds[finalLock.snapshot.modules[name]].manifest.files.filter((f: any) => f.path.startsWith('server/')));
    }
    const shell = JSON.parse(readFileSync(join(dir, 'shell/manifest.json'), 'utf8'));
    expect(shell.buildId).toBe(manifest.shell);
    for (const f of shell.files) {
        const bytes = readFileSync(join(dir, 'shell/artifact', f.path));
        const compiled = f.path.startsWith('client/') ? join(dir, '.hadars/static', f.path.slice(7)) : join(dir, '.hadars', f.path.slice(7));
        expect(bytes.equals(readFileSync(compiled))).toBe(true);
        expect(hash(bytes)).toBe(f.sha256);
    }
    expect(manifest.budgets).toEqual({ unitBytes: 9_000_000 });
    expect(readdirSync(join(dir, 'units')).sort()).toEqual(['admin', 'main', 'shop']);
    expect(verifyExport(dir, metadata).version).toBe(2);
    const plan = JSON.parse(await cli('composition', 'routing-plan', '.'));
    expect(plan.map((g: any) => g.group)).toEqual(['admin', 'shop', 'main']);
    for (const group of manifest.groups) {
        const file = join(dir, group.unit.file);
        const bytes = readFileSync(file);
        expect(hash(bytes)).toBe(group.unit.sha256);
        expect(bytes.length).toBe(group.unit.size);
        for (const name of ['admin', 'shop']) expect(bytes.toString().includes(name.toUpperCase() + '_SERVER_MARKER')).toBe(group.name === name);
        expect(bytes.length).toBeLessThan(spec.budgets.unitBytes);
        // Replace only the runtime-provided serve API; execute the complete generated unit.
        const source = bytes.toString().replace(/import \* as (\w+) from "@bunny.net\/edgescript-sdk";/, 'const $1 = { net: { http: { serve: h => globalThis.__splitTestHandler = h } } };');
        const runnable = join(dir, `execute-${group.name}.mjs`);
        write(runnable, source);
        delete (globalThis as any).__HADARS_SERVER_MODULE_STATE__;
        await import(runnable);
        const handler = (globalThis as any).__splitTestHandler;
        const response = await handler(new Request('http://local/__hadars/release'));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ release: manifest.releaseId, group: group.name, shell: manifest.shell });
        expect(response.headers.get('cache-control')).toBe('no-store');
        const document = await handler(new Request('http://local/document'));
        const html = await document.text();
        expect(html.split('__HADARS_RELEASE__').length).toBe(2);
        expect(html).toContain(JSON.stringify({ release: manifest.releaseId, group: group.name }));
        expect(html.indexOf('__HADARS_RELEASE__')).toBeLessThan(html.indexOf('src='));
        const data = await handler(new Request('http://local/document', { headers: {
            Accept: 'application/json', 'x-hadars-release-selector': manifest.releaseId,
        } }));
        expect(data.status).toBe(200);
        expect(JSON.stringify(await data.json())).toContain('data');
        const hook = await handler(new Request('http://local/'));
        expect(await hook.text()).toBe('hook');
        expect(hook.headers.get('x-hadars-group')).toBe(group.name);
        expect(hook.headers.get('x-hadars-release')).toBe(manifest.releaseId);
    }
    // Real listeners exercise the development/production probe before the configured hook.
    for (const mode of ['run', 'dev']) {
        const reservation = createServer();
        await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
        const port = (reservation.address() as { port: number }).port;
        await new Promise<void>(resolve => reservation.close(() => resolve()));
        const log = join(dir, `live-${mode}.log`);
        const fd = openSync(log, 'w');
        const server = Bun.spawn(['node', join(root, 'dist/cli.js'), mode], { cwd: dir,
            env: { ...process.env, PORT: String(port) }, stdout: fd, stderr: fd });
        try {
            const base = `http://127.0.0.1:${port}`;
            let response: Response | undefined;
            for (let i = 0; i < 150; i++) {
                if (server.exitCode !== null) throw new Error(readFileSync(log, 'utf8'));
                try { response = await fetch(base + '/__hadars/release?probe=1'); break; } catch {}
                await Bun.sleep(100);
            }
            if (!response) throw new Error(`Live ${mode} did not start: ${readFileSync(log, 'utf8')}`);
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ release: 'dev-all', group: 'dev-all', shell: earlier.snapshot.shell });
            expect(response.headers.get('cache-control')).toBe('no-store');
            expect(await (await fetch(base + '/admin/x', { headers: { 'x-hadars-release-selector': 'invalid' } })).text()).toBe('hook');
            expect(await (await fetch(base + '/administrator')).text()).toBe('hook');
            expect(readFileSync(log, 'utf8')).toContain('[split] GET /admin/x -> admin');
            expect(readFileSync(log, 'utf8')).toContain('[split] GET /administrator -> main');
        } finally { server.kill(); await server.exited; closeSync(fd); }
    }
    // Dev rebuilds the static graph; restore the completed split export for tamper checks.
    config({ ...spec, budgets: { unitBytes: 8_000_000 } });
    await cli('export', 'bunny');
    const configured = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(configured.budgets).toEqual({ unitBytes: 8_000_000 });
    expect(verifyExport(dir, metadata).version).toBe(2);
    const first = join(dir, manifest.groups[0].unit.file), second = join(dir, manifest.groups[1].unit.file);
    const original = readFileSync(first), other = readFileSync(second), json = readFileSync(manifestPath);
    writeFileSync(first, Buffer.concat([original, Buffer.from('\n// edited')]));
    expect(() => verifyExport(dir, metadata)).toThrow('Entry script changed');
    writeFileSync(first, original);
    rmSync(first);
    expect(() => verifyExport(dir, metadata)).toThrow('Missing entry script');
    writeFileSync(first, original);
    write(join(dir, 'units/extra/bunny.mjs'), 'extra');
    expect(() => verifyExport(dir, metadata)).toThrow('Extra unit');
    rmSync(join(dir, 'units/extra'), { recursive: true });
    writeFileSync(manifestPath, '{}');
    expect(() => verifyExport(dir, metadata)).toThrow('Entry script changed: .hadars/split-manifest.json');
    const edited = JSON.parse(json.toString()); edited.groups[0].patterns = ['/edited/**'];
    writeFileSync(manifestPath, JSON.stringify(edited));
    expect(() => verifyExport(dir, metadata)).toThrow('Entry script changed: .hadars/split-manifest.json');
    writeFileSync(manifestPath, json);
    writeFileSync(first, other); writeFileSync(second, original);
    expect(() => verifyExport(dir, metadata)).toThrow('Entry script changed');
    writeFileSync(first, original); writeFileSync(second, other);
    const asset = join(dir, '.hadars/static/_builds', pins[1]!.buildId, 'client/entry.js');
    const client = readFileSync(asset); writeFileSync(asset, 'edited');
    expect(() => verifyExport(dir, metadata)).toThrow('Static hash mismatch');
    rmSync(asset);
    expect(() => verifyExport(dir, metadata)).toThrow('Missing static file');
    writeFileSync(asset, client);
    write(join(dir, '.hadars/static/extra.js'), 'extra');
    expect(() => verifyExport(dir, metadata)).toThrow('Extra static file');
    rmSync(join(dir, '.hadars/static/extra.js'));
    const provenance = readFileSync(join(dir, metadata));
    const changed = JSON.parse(provenance.toString()); changed.shell = 'edited';
    writeFileSync(join(dir, metadata), JSON.stringify(changed));
    expect(() => verifyExport(dir, metadata)).toThrow('metadata checksum mismatch');
    writeFileSync(join(dir, metadata), provenance);
    expect(() => verifyExport(dir, metadata, 'untrusted')).toThrow('metadata checksum mismatch');
    expect(verifyExport(dir, metadata).version).toBe(2);
    await cli('export', 'bunny', '--no-emit-shell');
    const omitted = verifyExport(dir, metadata);
    expect(omitted.version).toBe(2);
    expect('shell' in omitted).toBe(false);
    expect(readdirSync(dir)).not.toContain('shell');
    // A frozen shim filename makes byte comparison meaningful (the legacy bundler emits its filename).
    config();
    await cli('export', 'bunny');
    const single = readFileSync(join(dir, 'bunny.mjs'));
    expect(verifyExport(dir, metadata).version).toBe(1);
    config({ mode: 'single' });
    await cli('export', 'bunny');
    expect(readFileSync(join(dir, 'bunny.mjs')).equals(single)).toBe(true);
    // Independently bundle the pre-split shim and options as a byte-for-byte legacy regression.
    const legacyDriver = join(dir, 'legacy.mjs');
    write(legacyDriver, `
        import { build } from ${JSON.stringify(join(root, 'node_modules/esbuild/lib/main.js'))};
        import { builtinModules } from 'node:module';
        import { writeFile } from 'node:fs/promises';
        import { assemblePinnedExport } from ${JSON.stringify(join(root, 'dist/composition/build.js'))};
        import { runtimeConfigPlugin } from ${JSON.stringify(join(root, 'src/utils/exportConfig.ts'))};
        const cwd = ${JSON.stringify(dir)}, root = ${JSON.stringify(root)};
        const link = cwd + '/.hadars-linked-1700000000000.js';
        const shim = cwd + '/.hadars-bunny-shim-1700000000000.ts';
        const config = cwd + '/hadars.config.ts';
        const clients = await assemblePinnedExport({ lockFile: cwd + '/lock.json', buildsDir: cwd + '/builds' }, cwd + '/.hadars/static', { file: link, runtime: root + '/dist/composition/runtime.js' });
        await writeFile(shim, [
            'import ' + JSON.stringify(link) + ';',
            'import * as BunnySDK from "@bunny.net/edgescript-sdk";',
            'import * as ssrModule from ' + JSON.stringify(cwd + '/.hadars/index.ssr.js') + ';',
            'import outHtml from ' + JSON.stringify(cwd + '/.hadars/static/out.html') + ';',
            'import { createBunnyHandler } from ' + JSON.stringify(root + '/dist/bunny.js') + ';',
            'import config from ' + JSON.stringify(config) + ';',
            'BunnySDK.net.http.serve(createBunnyHandler(config as any, { ssrModule: ssrModule as any, outHtml, pinnedClients: ' + JSON.stringify(clients) + ' }));',
        ].join('\\n') + '\\n');
        await build({ entryPoints: [shim], bundle: true, platform: 'browser', format: 'esm', target: ['es2022'],
            outfile: cwd + '/legacy.mjs.out', sourcemap: false, loader: { '.html': 'text', '.tsx': 'tsx', '.ts': 'ts' },
            external: ['@rspack/*', '@bunny.net/edgescript-sdk'], define: { global: 'globalThis', __EDGE_RUNTIME__: 'true' },
            plugins: [runtimeConfigPlugin(config), { name: 'node-builtins-external', setup(b) {
                b.onResolve({ filter: /^(?:node:)?[a-z_][a-z0-9_\\/-]*$/ }, args => {
                    const name = args.path.replace(/^node:/, '');
                    if (builtinModules.includes(name)) return { path: 'node:' + name, external: true };
                });
            } }],
        });
    `);
    const fd = openSync(join(dir, 'legacy.log'), 'w');
    try {
        const legacy = Bun.spawn(['node', legacyDriver], { cwd: dir, stdout: fd, stderr: fd });
        expect(await legacy.exited).toBe(0);
        expect(readFileSync(join(dir, 'legacy.mjs.out')).equals(single)).toBe(true);
    } finally { closeSync(fd); }
    config({ ...spec, budgets: { unitBytes: 1 } });
    await expect(cli('export', 'bunny')).rejects.toThrow('SPLIT_SIZE_EXCEEDED');
    expect(() => verifyExport(dir, metadata)).toThrow();
}, 120_000);
