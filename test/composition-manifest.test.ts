import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineManifest, validateManifest, orderManifests, type HadarsManifest, type PinnedBuild } from '../src/composition';
import { splitGroups } from '../src/composition/build';
import { buildModuleFromManifest, loadManifest } from '../src/composition/build';
import { createModuleBuild } from '../src/composition/artifacts';
import { computeBuildId } from '../src/composition/identity';

const dir = join(import.meta.dir, 'fixtures/composition-manifest');
const tmp = mkdtempSync(join(tmpdir(), 'hadars-manifest-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const base = { name: 'admin', exposes: { page: 'src/page.tsx' } } satisfies HadarsManifest;

test('defineManifest returns its argument and validation accepts a full manifest', () => {
    const m = defineManifest({ ...base, mounts: ['/admin/**'], routes: 'page', uses: ['badge'] });
    expect(m.mounts).toEqual(['/admin/**']);
    validateManifest(m);
});

test.each([
    [{ ...base, name: 'bad name' }, /name must use/],
    [{ ...base, exposes: {} }, /exposes nothing/],
    [{ ...base, exposes: { 'a-b': 'x.tsx' } }, /valid JavaScript identifier/],
    [{ ...base, mounts: ['/a/*'] }, /literal path/],
    [{ ...base, mounts: [] }, /nonempty/],
    [{ ...base, routes: 'page' }, /routes need mounts/],
    [{ ...base, mounts: ['/a'], routes: 'nope' }, /not an exposes entry/],
    [{ ...base, uses: ['admin'] }, /cannot use itself/],
])('rejects an invalid manifest %#', (manifest, message) => {
    expect(() => validateManifest(manifest as HadarsManifest)).toThrow(message);
});

test('orders modules by dependency and rejects cycles and unknown names', () => {
    const a = { ...base, name: 'a', uses: ['b'] }, b = { ...base, name: 'b', uses: ['c'] }, c = { ...base, name: 'c' };
    expect(orderManifests([a, b, c])).toEqual(['c', 'b', 'a']);
    expect(() => orderManifests([a, { ...b, uses: ['a'] }])).toThrow('a -> b -> a');
    expect(() => orderManifests([a])).toThrow('unknown module "b"');
});

test('loads hadars.manifest.ts and builds the module from it', async () => {
    const loaded = await loadManifest(dir);
    expect(loaded.manifest.mounts).toEqual(['/greet/**', '/hello']);
    const built = await buildModuleFromManifest(dir, { outDir: join(tmp, 'out') });
    expect(built.server.js).toEqual(['greeter.cjs']);
    expect(readFileSync(join(tmp, 'out/client/manifest.json'), 'utf8')).toContain('greeter.js');

    const pin = createModuleBuild({ ...built.options, buildsDir: join(tmp, 'builds'), result: built });
    expect(pin.manifest).toMatchObject({ mounts: ['/greet/**', '/hello'], routes: 'page', uses: ['badge'] });
    const { buildId, ...content } = pin.manifest;
    expect(computeBuildId(content)).toBe(buildId);
    // Ownership is part of the identity; a build without it keeps its old ID.
    const { mounts, routes, uses, ...plain } = content;
    expect(computeBuildId(plain)).not.toBe(buildId);
    expect(computeBuildId({ ...plain, mounts })).not.toBe(computeBuildId({ ...plain, mounts: ['/other'] }));
}, 60_000);

const pinned = (name: string, extra: Partial<PinnedBuild> = {}): PinnedBuild => ({
    name, kind: 'module', server: { dir: '/x', manifest: { js: [], css: [] } }, client: { baseUrl: '/', manifest: { js: [], css: [] } }, ...extra,
});

test('split groups come from module manifests; explicit mounts override', () => {
    const builds = { shell: pinned('shell', { kind: 'shell' }), admin: pinned('admin', { mounts: ['/admin/**'] }), dash: pinned('dash', { mounts: ['/dashboard/**'] }) };
    const groups = splitGroups({ mode: 'per-module', defaultGroup: 'main' }, builds)!;
    expect(groups.map((g) => [g.name, g.patterns])).toEqual([['dash', ['/dashboard/**']], ['admin', ['/admin/**']], ['main', []]]);
    const overridden = splitGroups({ mode: 'per-module', defaultGroup: 'main', mounts: { admin: ['/ops/**'] } }, builds)!;
    expect(overridden.find((g) => g.name === 'admin')!.patterns).toEqual(['/ops/**']);
    expect(() => splitGroups({ mode: 'per-module', defaultGroup: 'main' }, { shell: builds.shell, x: pinned('x') })).toThrow('SPLIT_MODULE_UNMOUNTED');
});

test('declarations ride with the build, verify through the lock, and type the shell', async () => {
    const { emitModuleTypes, writeShellTypes, createShellBuild, assembleLockfile, verifyLockfile, buildModuleFromManifest: build } = await import('../src/composition/build');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const ts = (await import('typescript')).default;
    const out = join(tmp, 'typed');
    const built = await build(dir, { outDir: out });
    const moduleTypes = emitModuleTypes({ manifest: built.options.manifest!, cwd: dir, outDir: out });
    expect(moduleTypes.types[0]).toBe('types/index.d.ts');
    expect(moduleTypes.typeApi.exports.page).toMatchObject({ title: '"page"' });

    const buildsDir = join(tmp, 'typed-builds');
    const pin = createModuleBuild({ ...built.options, buildsDir, result: built, moduleTypes });
    expect(pin.manifest.types).toEqual(moduleTypes.types);
    const shellSrc = join(tmp, 'typed-shell');
    mkdirSync(join(shellSrc, 'client'), { recursive: true }); mkdirSync(join(shellSrc, 'server'), { recursive: true });
    writeFileSync(join(shellSrc, 'client/main.js'), 'x'); writeFileSync(join(shellSrc, 'server/main.cjs'), 'module.exports={}');
    const shell = createShellBuild({ sourceDir: shellSrc, buildsDir, name: 'shell', provides: [],
        targets: { client: { js: ['client/main.js'], css: [] }, server: { js: ['server/main.cjs'], css: [] } } });
    const lockFile = join(tmp, 'typed.lock');
    writeFileSync(lockFile, JSON.stringify(assembleLockfile({ shell: shell.manifest, modules: [pin.manifest] })));
    // The fixture declares `uses: ['badge']`; a pin set without that module is refused.
    await expect(verifyLockfile({ lockFile, buildsDir })).rejects.toThrow('uses "badge"');
    const standalone = createModuleBuild({ ...built.options, manifest: { ...built.options.manifest!, uses: undefined }, buildsDir, result: built, moduleTypes });
    writeFileSync(lockFile, JSON.stringify(assembleLockfile({ shell: shell.manifest, modules: [standalone.manifest] })));
    const resolved = await verifyLockfile({ lockFile, buildsDir });
    expect(resolved.greeter!.client.files!.some((f) => f.endsWith('.d.ts'))).toBe(false);

    // The shell's generated file points at the pinned declarations.
    const shellTypes = join(tmp, 'shell/hadars-modules.d.ts');
    expect(writeShellTypes(shellTypes, { greeter: join(pin.dir, 'types/index.d.ts') })).toBe(true);
    expect(writeShellTypes(shellTypes, { greeter: join(pin.dir, 'types/index.d.ts') })).toBe(false);
    const use = join(tmp, 'shell/use.ts');
    writeFileSync(use, `import { getModule } from ${JSON.stringify(join(import.meta.dir, '../src/composition/registry'))};\n`
        + `export const title: string = getModule('greeter').page.title;\n`
        + `// @ts-expect-error unknown export\nexport const bad = getModule('greeter').page.nope;\n`);
    const program = ts.createProgram([use, shellTypes], { noEmit: true, strict: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX,
        moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, types: [] });
    const problems = ts.getPreEmitDiagnostics(program).filter((d) => d.file && !d.file.fileName.includes('node_modules'))
        .map((d) => `${d.file!.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    expect(problems).toEqual([]);
}, 120_000);
