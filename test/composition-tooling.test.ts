import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModule, createModuleBuild, createShellBuild, createIntegrityMap, assembleLockfile, verifyLockfile, computeBuildId } from '../src/composition/build';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

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
    writeFileSync(join(f.dir, 'App.tsx'), `import { ModuleHead } from 'hadars/composition/runtime';
        export function getInitProps(req) { return { client: req.pinnedClients.greeter }; }
        export default function App({ client }) { return <><ModuleHead client={client} /><div>composed shell</div></>; }`);
    writeFileSync(join(f.dir, 'hadars.config.ts'), `export default { entry: 'App.tsx',
        composition: { role: 'shell', name: 'shell', pinned: { lockFile: 'hadars.lock', buildsDir: 'builds' } } };`);
    const output = join(f.dir, 'edge.mjs');
    const child = Bun.spawn([process.execPath, join(root, 'dist/cli.js'), 'export', 'bunny', output], { cwd: f.dir, stdout: 'pipe', stderr: 'pipe' });
    const [status, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
    if (status !== 0) throw new Error(stdout + stderr);
    const code = readFileSync(output, 'utf8');
    expect(code).not.toMatch(/node:fs|fs\/promises/);
    expect(code).not.toContain('server/greeter.cjs');
    expect(readFileSync(join(f.dir, '.hadars/static/_builds', f.module.manifest.buildId, 'client/greeter.js'))).toEqual(readFileSync(join(f.module.dir, 'client/greeter.js')));
    const sdk = code.match(/from "(@[^\"]+sdk)"/);
    expect(sdk).not.toBeNull();
    writeFileSync(join(f.dir, 'sdk.mjs'), 'export const net = { http: { serve(handler) { globalThis.__hadarsPinnedExportHandler = handler; } } };');
    writeFileSync(output, code.replaceAll(sdk![1]!, './sdk.mjs'));
    rmSync(f.options.buildsDir, { recursive: true });
    try {
        await import(output);
        const response = await (globalThis as any).__hadarsPinnedExportHandler(new Request('https://example.test/'));
        const html = await response.text();
        expect(response.status).toBe(200);
        expect(html).toContain('composed shell');
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
    expect(() => assembleLockfile({ shell: f.shell.manifest, modules: [incompatible.manifest] })).toThrow('shared-context');
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
    await expect(verifyLockfile(f.options)).rejects.toThrow(message);
    await expect(verifyLockfile(f.options, true)).rejects.toThrow(message);
    await expect(assemblePinnedExport(f.options, join(f.dir, 'static'))).rejects.toThrow(message);
});

test('dev override requirements are checked against the pinned shell', async () => {
    const f = await fixture({ required: '^1.0.0', provided: '1.4.0' });
    writeFileSync(join(f.dir, 'module/composition.json'), JSON.stringify({ requires: { 'shared-context': '^3.0.0' } }));
    await expect(verifyLockfile({ ...f.options, overrides: { greeter: {
        serverDir: join(f.dir, 'module/server'), clientUrl: 'http://127.0.0.1:4200/',
    } } }, true)).rejects.toThrow('package "shared-context" range "^3.0.0"; shell provides "1.4.0"');
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
