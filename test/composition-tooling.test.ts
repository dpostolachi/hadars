import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModule, createModuleBuild, createShellBuild, createIntegrityMap, assembleLockfile, verifyLockfile, computeBuildId, CompositionCompatibilityError, type CompositionCompatibilityDetails, type BuildManifest } from '../src/composition/build';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function compatibilityError(action: () => unknown, fields: CompositionCompatibilityDetails, message: string) {
    let error: unknown;
    try { await action(); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CompositionCompatibilityError);
    expect(error).toMatchObject({ name: 'CompositionCompatibilityError', ...fields });
    expect((error as Error).message).toContain(message);
}

async function fixture(versions?: { required: string; provided: string }) {
    const dir = mkdtempSync(join(tmpdir(), 'hadars-artifacts-'));
    dirs.push(dir);
    const buildsDir = join(dir, 'builds');
    const cwd = join(import.meta.dir, 'fixtures/composition-module');
    const opts = { cwd, outDir: join(dir, 'module'), buildsDir,
        composition: { role: 'module' as const, name: 'greeter', exposes: { page: 'src/page.tsx' },
            ...(versions ? { requires: { 'shared-context': versions.required }, shared: ['shared-context'] } : {}) } };
    const module = createModuleBuild({ ...opts, result: await buildModule(opts) });
    const sourceDir = join(dir, 'shell');
    mkdirSync(join(sourceDir, 'client'), { recursive: true });
    mkdirSync(join(sourceDir, 'server'), { recursive: true });
    writeFileSync(join(sourceDir, 'client/main.js'), 'globalThis.shell = true;');
    writeFileSync(join(sourceDir, 'server/main.cjs'), 'module.exports = {};');
    const shellOpts = { sourceDir, buildsDir, name: 'shell', provides: versions ? { 'shared-context': versions.provided } : ['shared-context'],
        targets: { client: { js: ['client/main.js'], css: [] }, server: { js: ['server/main.cjs'], css: [] } } };
    const shell = createShellBuild(shellOpts);
    const lock = assembleLockfile({ shell: shell.manifest, modules: [module.manifest] });
    const lockFile = join(dir, 'hadars.lock');
    writeFileSync(lockFile, JSON.stringify(lock));
    writeFileSync(join(dir, 'integrity.json'), JSON.stringify(createIntegrityMap([shell.manifest, module.manifest])));
    return { dir, module, shell, shellOpts, lock, options: { lockFile, buildsDir } };
}

test('module output and real shell artifacts round trip through v1 identity, integrity and lock verification', async () => {
    const f = await fixture();
    const builds = await verifyLockfile(f.options);
    expect(builds.greeter!.client.manifest.js).toEqual(['client/greeter.js']);
    expect(f.shell.manifest.provides).toEqual(['shared-context']);
    expect(f.shell.manifest.files.length).toBe(2);
    expect(computeBuildId(f.module.manifest)).toBe(f.module.manifest.buildId);
    expect(f.module.integrity[`${f.module.manifest.buildId}/client/greeter.js`]).toStartWith('sha256-');
    expect(createShellBuild(f.shellOpts).manifest).toEqual(f.shell.manifest);
    expect(readFileSync(join(f.shell.dir, 'server/main.cjs'), 'utf8')).toBe('module.exports = {};');
    const { buildId, ...identity } = f.shell.manifest;
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16)).toBe(buildId);
});

test('verification rejects tampering and publication cannot overwrite an immutable shell build', async () => {
    const f = await fixture();
    writeFileSync(join(f.shell.dir, 'client/main.js'), 'globalThis.shell = nope;');
    await expect(verifyLockfile(f.options)).rejects.toThrow('sha256 mismatch');
    expect(() => createShellBuild(f.shellOpts)).toThrow('Immutable build');
});

test('lock assembly rejects changed manifest identities and duplicate names', async () => {
    const f = await fixture();
    expect(() => assembleLockfile({ shell: { ...f.shell.manifest, requires: { dependency: '^2' } } })).toThrow('identity mismatch');
    expect(() => assembleLockfile({ shell: f.shell.manifest, modules: [{ ...f.module.manifest, name: 'shell' }] })).toThrow('Duplicate');
});

test('composition CLI verifies a lock without an app config', async () => {
    const f = await fixture();
    const { runCli } = await import('../cli-lib');
    await runCli(['bun', 'hadars', 'composition', 'verify', f.options.lockFile, f.options.buildsDir], f.dir);
    rmSync(join(f.module.dir, 'client/greeter.js'));
    await expect(runCli(['bun', 'hadars', 'composition', 'verify', f.options.lockFile, f.options.buildsDir], f.dir)).rejects.toThrow('Pinned build');
});

test('export assembly copies only declared client assets and embeds only public descriptors', async () => {
    const f = await fixture();
    const { assemblePinnedExport } = await import('../src/composition/build');
    const output = join(f.dir, 'static');
    const clients = await assemblePinnedExport(f.options, output);
    expect(Object.keys(clients)).toEqual(['greeter']);
    expect(JSON.stringify(clients)).not.toContain(f.dir);
    expect(JSON.stringify(clients)).not.toContain('server');
    const client = clients.greeter!;
    expect(readFileSync(join(output, client.baseUrl, 'client/greeter.js'))).toEqual(readFileSync(join(f.module.dir, 'client/greeter.js')));
    expect(client.integrity!['client/greeter.js']).toStartWith('sha256-');
    const { createBunnyHandler } = await import('../src/bunny');
    const handler = createBunnyHandler({ entry: '', fetch: (req) => Response.json(req.pinnedClients) },
        { ssrModule: { default: () => null }, outHtml: '', pinnedClients: clients });
    expect(await (await handler(new Request('https://example.test/'))).json()).toEqual(clients);
});

test('export assembly rejects missing, hash-mismatched and undeclared pinned files before copying', async () => {
    const { assemblePinnedExport } = await import('../src/composition/build');
    for (const mode of ['missing', 'hash', 'undeclared']) {
        const f = await fixture();
        const file = join(f.module.dir, 'client/greeter.js');
        if (mode === 'missing') rmSync(file);
        else if (mode === 'hash') {
            const bytes = readFileSync(file); bytes[0] = bytes[0]! ^ 1; writeFileSync(file, bytes);
        } else writeFileSync(join(f.module.dir, 'client/extra.js'), 'unexpected');
        await expect(assemblePinnedExport(f.options, join(f.dir, 'static'))).rejects.toThrow(mode === 'hash' ? 'sha256 mismatch' : mode === 'undeclared' ? 'undeclared' : 'ENOENT');
    }
});

test('edge export runs a composed shell without pinned directories or a resolver alias', async () => {
    const f = await fixture();
    const root = join(import.meta.dir, '..');
    const { symlinkSync } = await import('node:fs');
    symlinkSync(join(root, 'test/fixtures/composition-shell/node_modules'), join(f.dir, 'node_modules'), 'dir');
    writeFileSync(join(f.dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'bundler' } }));
    writeFileSync(join(f.dir, 'shared-api.ts'), 'export const token = { marker: "shell-copy-unique-marker" };');
    writeFileSync(join(f.dir, 'module.tsx'), `import { token } from 'shared-api';
        import { useState } from 'react';
        export { useState, token };
        export function View() { const [value] = useState('linked server output'); return <p>{value}</p>; }`);
    const opts = { cwd: f.dir, outDir: join(f.dir, 'second'), buildsDir: f.options.buildsDir,
        composition: { role: 'module' as const, name: 'second', exposes: { page: 'module.tsx' }, shared: ['shared-api'] } };
    const second = createModuleBuild({ ...opts, result: await buildModule(opts) });
    const shell = createShellBuild({ ...f.shellOpts, provides: ['shared-context', 'shared-api'] });
    const lock = assembleLockfile({ shell: shell.manifest, modules: [f.module.manifest, second.manifest] });
    writeFileSync(f.options.lockFile, JSON.stringify(lock));
    writeFileSync(join(f.dir, 'App.tsx'), `import * as React from 'react';
        import * as jsx from 'react/jsx-runtime';
        import * as jsxDev from 'react/jsx-dev-runtime';
        import { token } from './shared-api';
        import { ModuleHead, provideShared, getModule } from 'hadars/composition/runtime';
        provideShared({ react: React, 'react/jsx-runtime': jsx, 'react/jsx-dev-runtime': jsxDev, 'shared-api': { token } });
        export function getInitProps(req) {
            const linked = getModule('second');
            if (linked !== getModule('second') || linked.page.token !== token || linked.page.useState !== React.useState) throw new Error('shared identity mismatch');
            return { client: req.pinnedClients.greeter };
        }
        export default function App({ client }) {
            const View = getModule('second').page.View;
            return <><ModuleHead client={client} /><div>composed shell {getModule('greeter').page.title}</div><View /></>;
        }`);
    writeFileSync(join(f.dir, 'compiler-plugin.mjs'), `import { existsSync } from 'node:fs';
        import path from 'node:path';
        globalThis.__compilerPluginLoaded = true;
        export default { apply() { if (!existsSync(path.resolve('App.tsx'))) throw new Error('missing entry'); } };`);
    writeFileSync(join(f.dir, 'hadars.config.ts'), `import compilerPlugin from './compiler-plugin.mjs';
        const buildOnly = { plugins: [compilerPlugin], optimization: { marker: 'build-only-option-marker' } };
        export default { ...buildOnly, entry: 'App.tsx',
        fetch: req => req.pathname === '/runtime-hook' ? new Response('runtime hook retained') : undefined,
        onResponse: response => { response.headers.set('x-runtime-hook', 'retained'); },
        composition: { role: 'shell', name: 'shell', pinned: { lockFile: 'hadars.lock', buildsDir: 'builds' } } };`);
    const output = join(f.dir, 'edge.mjs');
    const child = Bun.spawn([process.execPath, join(root, 'dist/cli.js'), 'export', 'bunny', output], { cwd: f.dir, stdout: 'pipe', stderr: 'pipe' });
    const [status, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
    if (status !== 0) throw new Error(stdout + stderr);
    expect(stdout).toContain('Linked module \"greeter\"');
    expect(stdout).toContain('Linked module \"second\"');
    const code = readFileSync(output, 'utf8');
    // Catch every prefixed specifier, including static imports and dynamic imports.
    expect(code).not.toMatch(/["'`]node:[^"'`]+["'`]/);
    // Also retain the bare filesystem module check.
    expect([...code.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*["'](?:node:)?(?:fs|path)(?:\/[^"']*)?["']/g)]).toEqual([]);
    expect(code).not.toContain('__compilerPluginLoaded');
    expect(code).not.toContain('build-only-option-marker');
    expect(code.split('shell-copy-unique-marker')).toHaveLength(2);
    const provenance = readFileSync(join(f.dir, '.hadars/static/composition-provenance.json'), 'utf8');
    expect(provenance).not.toContain(f.dir);
    expect(JSON.parse(provenance).modules.second).toMatchObject({ buildId: second.manifest.buildId, server: expect.arrayContaining([expect.objectContaining({ path: 'server/second.cjs', sha256: expect.any(String) })]) });
    expect(code).not.toContain('server/greeter.cjs');
    expect(readFileSync(join(f.dir, '.hadars/static/_builds', f.module.manifest.buildId, 'client/greeter.js'))).toEqual(readFileSync(join(f.module.dir, 'client/greeter.js')));
    const sdk = code.match(/from "(@[^\"]+sdk)"/);
    expect(sdk).not.toBeNull();
    writeFileSync(join(f.dir, 'sdk.mjs'), 'export const net = { http: { serve(handler) { globalThis.__hadarsPinnedExportHandler = handler; } } };');
    writeFileSync(output, code.replaceAll(sdk![1]!, './sdk.mjs'));
    for (const target of ['cloudflare', 'lambda']) {
        const file = join(f.dir, `${target}.mjs`);
        const exportProcess = Bun.spawn([process.execPath, join(root, 'dist/cli.js'), 'export', target, file], {
            cwd: f.dir, stdout: 'pipe', stderr: 'pipe',
        });
        const [exitCode, errors, logs] = await Promise.all([exportProcess.exited,
            new Response(exportProcess.stderr).text(), new Response(exportProcess.stdout).text()]);
        if (exitCode !== 0) throw new Error(logs + errors);
        const exported = readFileSync(file, 'utf8');
        if (target === 'lambda') {
            expect(/import\(["'](?:node:)?zlib["']\)/.test(exported)).toBe(true);
            expect(/import\(["'](?:node:)?util["']\)/.test(exported)).toBe(true);
        } else {
            expect(exported).not.toMatch(/["'`]node:[^"'`]+["'`]/);
        }
    }
    rmSync(f.options.buildsDir, { recursive: true });
    try {
        await import(output);
        const response = await (globalThis as any).__hadarsPinnedExportHandler(new Request('https://example.test/'));
        const html = await response.text();
        expect(response.status).toBe(200);
        expect(response.headers.get('x-runtime-hook')).toBe('retained');
        const hookResponse = await (globalThis as any).__hadarsPinnedExportHandler(new Request('https://example.test/runtime-hook'));
        expect(await hookResponse.text()).toBe('runtime hook retained');
        expect(html).toContain('composed shell');
        expect(html).toContain('linked server output');
        expect(html).toContain('page');
        expect(html).toContain(`/_builds/${f.module.manifest.buildId}/client/greeter.js`);
        expect(html).toContain('sha256-');
    } finally { delete (globalThis as any).__hadarsPinnedExportHandler; }
}, 60_000);

test('contract 2 pins versioned provides and enforces ranges in production, dev and export', async () => {
    const f = await fixture({ required: '^1.0.0', provided: '1.4.0' });
    expect(f.shell.manifest.runtimeContract).toBe('2');
    expect(f.module.manifest.runtimeContract).toBe('2');
    expect(f.shell.manifest.provides).toEqual({ 'shared-context': '1.4.0' });
    await verifyLockfile(f.options);
    const { createBuild, assemblePinnedExport } = await import('../src/composition/build');
    const incompatible = createBuild({ ...f.module.manifest, sourceDir: f.module.dir, buildsDir: f.options.buildsDir,
        runtimeContract: '2', requires: { 'shared-context': '^2.0.0' } });
    const fields = { module: 'greeter', package: 'shared-context', requiredRange: '^2.0.0', providedVersion: '1.4.0', kind: 'version' as const };
    await compatibilityError(() => assembleLockfile({ shell: f.shell.manifest, modules: [incompatible.manifest] }), fields,
        'Module "greeter" requires package "shared-context" range "^2.0.0"; shell provides "1.4.0"');
    // Simulate an externally produced, self-consistent lock containing incompatible pins.
    const { hash, canonical } = await import('../src/composition/identity');
    const lock = assembleLockfile({ shell: f.shell.manifest });
    lock.snapshot.modules.greeter = incompatible.manifest.buildId;
    lock.builds[incompatible.manifest.buildId] = { manifest: incompatible.manifest, sha256: hash(canonical(incompatible.manifest)) };
    const { shell, modules, libraries } = lock.snapshot;
    lock.snapshot.id = 'snap_' + hash(JSON.stringify({ shell, modules, libraries })).slice(0, 16);
    lock.snapshotId = lock.snapshot.id;
    lock.snapshotSha256 = hash(canonical(lock.snapshot));
    writeFileSync(f.options.lockFile, JSON.stringify(lock));
    const message = 'package "shared-context" range "^2.0.0"; shell provides "1.4.0"';
    await compatibilityError(() => verifyLockfile(f.options), fields, message);
    await compatibilityError(() => verifyLockfile(f.options, true), fields, message);
    await compatibilityError(() => assemblePinnedExport(f.options, join(f.dir, 'static')), fields, message);
});

test('dev override requirements are checked against the pinned shell', async () => {
    const f = await fixture({ required: '^1.0.0', provided: '1.4.0' });
    writeFileSync(join(f.dir, 'module/composition.json'), JSON.stringify({ requires: { 'shared-context': '^3.0.0' } }));
    await compatibilityError(() => verifyLockfile({ ...f.options, overrides: { greeter: {
        serverDir: join(f.dir, 'module/server'), clientUrl: 'http://127.0.0.1:4200/',
    } } }, true), { module: 'greeter', package: 'shared-context', requiredRange: '^3.0.0', providedVersion: '1.4.0', kind: 'version' },
        'package "shared-context" range "^3.0.0"; shell provides "1.4.0"');
});

test('module tooling can infer exact shared requirements from installed dependencies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hadars-infer-versions-'));
    dirs.push(dir);
    const dependency = join(dir, 'node_modules/shared-api');
    mkdirSync(dependency, { recursive: true });
    writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: 'shared-api', version: '2.3.4', main: 'index.js' }));
    writeFileSync(join(dependency, 'index.js'), 'module.exports = {};');
    writeFileSync(join(dir, 'entry.ts'), 'export const value = 1;');
    const opts = { cwd: dir, outDir: join(dir, 'output'), buildsDir: join(dir, 'builds'), inferRequires: ['shared-api'],
        composition: { role: 'module' as const, name: 'inferred', exposes: { main: 'entry.ts' }, shared: ['shared-api'] } };
    const result = await buildModule(opts);
    const build = createModuleBuild({ ...opts, result });
    expect(build.manifest.requires).toEqual({ 'shared-api': '2.3.4' });
    expect(JSON.parse(readFileSync(join(opts.outDir, 'composition.json'), 'utf8')).requires).toEqual(build.manifest.requires);
    expect(build.manifest.runtimeContract).toBe('2');
});

test('contract, flavour and missing shared compatibility errors keep their fields through resolution and export', async () => {
    const f = await fixture();
    const { hash, canonical } = await import('../src/composition/identity');
    const { assemblePinnedExport } = await import('../src/composition/build');
    const cases: Array<{ target: 'shell' | 'module'; patch: Partial<BuildManifest>; fields: CompositionCompatibilityDetails; message: string; dev?: boolean; assembly?: boolean }> = [
        { target: 'module', patch: { runtimeContract: '99' }, fields: { module: 'greeter', kind: 'contract', requiredRange: '1 | 2', providedVersion: '99' }, message: 'incompatible runtime contract or flavour', assembly: true },
        { target: 'shell', patch: { runtimeContract: '99' }, fields: { module: 'shell', kind: 'contract', requiredRange: '1 | 2', providedVersion: '99' }, message: 'incompatible runtime contract or flavour', assembly: true },
        { target: 'module', patch: { flavour: 'unknown' as BuildManifest['flavour'] }, fields: { module: 'greeter', kind: 'flavour', requiredRange: 'production | dev', providedVersion: 'unknown' }, message: 'incompatible runtime contract or flavour', dev: true, assembly: true },
        { target: 'module', patch: { flavour: 'dev' }, fields: { module: 'greeter', kind: 'flavour', requiredRange: 'production', providedVersion: 'dev' }, message: 'flavour differs from the pinned shell', dev: true, assembly: true },
        { target: 'shell', patch: { flavour: 'dev' }, fields: { module: 'shell', kind: 'flavour', requiredRange: 'production', providedVersion: 'dev' }, message: 'incompatible runtime contract or flavour' },
        { target: 'module', patch: { shared: ['missing-api'] }, fields: { module: 'greeter', kind: 'shared', package: 'missing-api', requiredRange: undefined, providedVersion: undefined }, message: 'shared package "missing-api" is not provided by the pinned shell' },
    ];
    for (const c of cases) {
        const shell = { ...f.shell.manifest, ...(c.target === 'shell' ? c.patch : {}) };
        const module = { ...f.module.manifest, ...(c.target === 'module' ? c.patch : {}) };
        shell.buildId = computeBuildId(shell);
        module.buildId = computeBuildId(module);
        if (c.assembly) await compatibilityError(() => assembleLockfile({ shell, modules: [module] }), c.fields, c.message);
        // External lock producers can supply internally consistent but incompatible manifests.
        const snapshot = { shell: shell.buildId, modules: { greeter: module.buildId }, libraries: {} };
        const id = 'snap_' + hash(JSON.stringify(snapshot)).slice(0, 16);
        const fullSnapshot = { ...snapshot, id };
        const lock = { version: 1, snapshot: fullSnapshot, snapshotId: id, snapshotSha256: hash(canonical(fullSnapshot)),
            builds: Object.fromEntries([shell, module].map((manifest) => [manifest.buildId, { manifest, sha256: hash(canonical(manifest)) }])) };
        writeFileSync(f.options.lockFile, JSON.stringify(lock));
        await compatibilityError(() => verifyLockfile(f.options, c.dev), c.fields, c.message);
        if (!c.dev) await compatibilityError(() => assemblePinnedExport(f.options, join(f.dir, 'static')), c.fields, c.message);
    }
});

test('linked export rejects changed or missing server bytes before staging assets', async () => {
    const { assemblePinnedExport } = await import('../src/composition/build');
    for (const mode of ['size', 'hash', 'missing']) {
        const f = await fixture();
        const file = join(f.module.dir, 'server/greeter.cjs');
        if (mode === 'missing') rmSync(file);
        else if (mode === 'size') writeFileSync(file, 'changed');
        else { const bytes = readFileSync(file); bytes[0] = bytes[0]! ^ 1; writeFileSync(file, bytes); }
        const output = join(f.dir, 'static');
        await expect(assemblePinnedExport(f.options, output, { file: join(f.dir, 'link.js'), runtime: 'unused' }))
            .rejects.toThrow(mode === 'hash' ? 'sha256 mismatch' : mode === 'size' ? 'size mismatch' : 'ENOENT');
        expect((await import('node:fs')).existsSync(output)).toBe(false);
    }
});

test('server linking rejects unsupported dependencies with a named module error', async () => {
    const { linkServer } = await import('../src/composition/linkServer');
    for (const source of ["module.exports = require('node:fs');", 'module.exports = require(globalThis.entry);', "module.exports = require('./missing.cjs');"]) {
        await expect(linkServer('example', 'server/main.cjs', new Map([['server/main.cjs', Buffer.from(source)]])))
            .rejects.toMatchObject({ name: 'CompositionLinkError', module: 'example' });
    }
});

test('a server entry is mandatory unless the immutable module explicitly declares clientOnly', async () => {
    const { createBuild, assemblePinnedExport } = await import('../src/composition/build');
    const f = await fixture();
    const options = { sourceDir: f.module.dir, buildsDir: f.options.buildsDir, kind: 'module' as const,
        name: 'greeter', exposes: ['page'], targets: { client: f.module.manifest.targets.client, server: { js: [], css: [] } } };
    for (const clientOnly of [false, true]) {
        const module = createBuild({ ...options, clientOnly });
        writeFileSync(f.options.lockFile, JSON.stringify(assembleLockfile({ shell: f.shell.manifest, modules: [module.manifest] })));
        const file = join(f.dir, 'linked.js');
        const result = assemblePinnedExport(f.options, join(f.dir, 'static'), { file, runtime: 'unused' });
        if (!clientOnly) await expect(result).rejects.toMatchObject({ name: 'CompositionLinkError', module: 'greeter' });
        else {
            expect((await result).greeter).toBeDefined();
            expect(readFileSync(file, 'utf8')).not.toContain('registerLinkedModule("greeter"');
            expect(JSON.parse(readFileSync(join(f.dir, 'static/composition-provenance.json'), 'utf8')).modules.greeter)
                .toMatchObject({ clientOnly: true, server: [] });
        }
    }
});

test('clientOnly module builds omit the server entry', async () => {
    const f = await fixture();
    const result = await buildModule({ cwd: join(import.meta.dir, 'fixtures/composition-module'), outDir: join(f.dir, 'browser-only'),
        composition: { role: 'module', name: 'browser-only', clientOnly: true, exposes: { page: 'src/page.tsx' } } });
    expect(result.client.js.length).toBe(1);
    expect(result.server.js).toEqual([]);
});

test('node descriptors and directories still load into the same application lookup', async () => {
    const f = await fixture();
    const { loadServerModule } = await import('../src/composition/build');
    const { registerModule, getModule } = await import('../src/composition/runtime');
    const builds = await verifyLockfile(f.options);
    const { registerServerModules } = await import('../src/composition/registerServerModules');
    registerServerModules(builds);
    expect(getModule('greeter').page.title).toBe('page');
    const module = await loadServerModule(builds.greeter!.server);
    registerModule('node-example', module);
    expect(getModule('node-example')).toBe(module);
    expect(getModule('node-example').page.title).toBe('page');
    expect((await loadServerModule(join(f.dir, 'module/server'))).page.title).toBe('page');
});

test('export rejects a pinned server dependency that cannot be statically linked', async () => {
    const { createBuild, assemblePinnedExport } = await import('../src/composition/build');
    const f = await fixture();
    const sourceDir = join(f.dir, 'unsupported');
    mkdirSync(join(sourceDir, 'client'), { recursive: true });
    mkdirSync(join(sourceDir, 'server'), { recursive: true });
    writeFileSync(join(sourceDir, 'client/main.js'), 'globalThis.example = {};');
    writeFileSync(join(sourceDir, 'server/main.cjs'), "module.exports = require('node:path');");
    const module = createBuild({ sourceDir, buildsDir: f.options.buildsDir, kind: 'module', name: 'unsupported', exposes: ['page'],
        targets: { client: { js: ['client/main.js'], css: [] }, server: { js: ['server/main.cjs'], css: [] } } });
    writeFileSync(f.options.lockFile, JSON.stringify(assembleLockfile({ shell: f.shell.manifest, modules: [module.manifest] })));
    await expect(assemblePinnedExport(f.options, join(f.dir, 'static'), { file: join(f.dir, 'linked.js'), runtime: 'unused' }))
        .rejects.toMatchObject({ name: 'CompositionLinkError', module: 'unsupported' });
    expect((await import('node:fs')).existsSync(join(f.dir, 'static'))).toBe(false);
});
