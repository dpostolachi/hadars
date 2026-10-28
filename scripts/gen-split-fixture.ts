/** Run from the repository root: bun scripts/gen-split-fixture.ts [destination]. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { exportScriptOptions } from '../src/utils/exportScript';
import { createBuild, assembleLockfile } from '../src/composition/artifacts';
import { assemblePinnedExport } from '../src/composition/exportBuilds';
import { completeSplitExport, RELEASE_PLACEHOLDER } from '../src/composition/exportIntegrity';
import { pinExportShell } from '../src/composition/exportShell';
import { hash } from '../src/composition/identity';
import { splitGroups, routingPlan, matchGroup, type SplitManifest } from '../src/composition/split';
const destination = resolve(process.argv[2] ?? 'test/fixtures/split-export');
const scratch = mkdtempSync(join(tmpdir(), 'split-vector-'));
function write(file: string, bytes: string | Uint8Array) { mkdirSync(resolve(file, '..'), { recursive: true }); writeFileSync(file, bytes); }
try {
    rmSync(destination, { recursive: true, force: true });
    const pins = ['shell', 'admin', 'shop'].map(name => {
        const source = join(scratch, name);
        write(join(source, 'client/entry.js'), `globalThis.${name}Client = true;\n`);
        write(join(source, 'server/entry.cjs'), `module.exports = { marker: '${name}' };\n`);
        return createBuild({ sourceDir: source, buildsDir: join(scratch, 'builds'), kind: name === 'shell' ? 'shell' : 'module', name,
            exposes: name === 'shell' ? [] : ['page'], targets: { client: { js: ['client/entry.js'], css: [] }, server: { js: ['server/entry.cjs'], css: [] } } }).manifest;
    });
    let lock = assembleLockfile({ shell: pins[0]!, modules: pins.slice(1) });
    write(join(scratch, 'lock.json'), JSON.stringify(lock));
    const staticDir = join(destination, '.hadars/static');
    await assemblePinnedExport({ lockFile: join(scratch, 'lock.json'), buildsDir: join(scratch, 'builds') }, staticDir);
    write(join(destination, '.hadars/index.ssr.js'), 'export default () => null;\n');
    write(join(staticDir, 'index.js'), 'globalThis.shellClient = true;\n');
    write(join(staticDir, 'out.html'), '<!doctype html><title>Split fixture</title>\n');
    lock = pinExportShell(destination, lock, join(scratch, 'builds')).lock;
    write(join(scratch, 'lock.json'), JSON.stringify(lock));
    await assemblePinnedExport({ lockFile: join(scratch, 'lock.json'), buildsDir: join(scratch, 'builds') }, staticDir);
    const groups = splitGroups({ mode: 'per-module', defaultGroup: 'main', mounts: { admin: ['/admin/**', '/control'], shop: ['/shop/**', '/buy'] } },
        Object.fromEntries(pins.map(p => [p.name, { ...p }])) as any)!;
    const manifest: SplitManifest = { version: 1, releaseId: '', mode: 'per-module', defaultGroup: 'main', shell: lock.snapshot.shell,
        snapshot: lock.snapshotId, probe: { path: '/__hadars/release' }, budgets: { unitBytes: 9_000_000 }, groups };
    for (const group of groups) {
        group.unit.file = `units/${group.name}/bunny.mjs`;
        // Adapter-neutral miniature units exercise the real runtime and production export completion.
        const result = await build({ stdin: { contents: `import { splitHandler } from './src/composition/splitRuntime.ts';
            export default splitHandler(async () => new Response(${JSON.stringify('<!doctype html><html><head><script src="/index.js"></script></head><body><main>' + group.name + '</main></body></html>')}, { headers: { 'content-type': 'text/html' } }), ${JSON.stringify({ release: RELEASE_PLACEHOLDER, group: group.name, shell: manifest.shell })});`, resolveDir: process.cwd(), sourcefile: 'fixture.ts' },
            bundle: true, format: 'esm', target: 'es2022', ...exportScriptOptions('1'), write: false });
        write(join(destination, group.unit.file), result.outputFiles[0]!.contents);
    }
    const output = completeSplitExport(destination, manifest, staticDir, {}, true);
    rmSync(join(destination, '.hadars/index.ssr.js'));
    rmSync(join(destination, '.hadars/export.lock.json'));
    const paths = ['/', '/admin', '/admin/', '/admin/a', '/admin/a/b', '/administrator', '/admin2', '/ADMIN', '//admin', '/%61dmin', '/admin%2Fx', '/admin/%2F', '/admin//x', '/admin/../shop', '/admin?x=1#f', '/shop', '/shop/', '/shop/item', '/shopping', '/shop2', '/SHOP', '/shop%2Fx', '/shop/%2f', '/shop//item', '/control', '/control/', '/control/x', '/controller', '/buy', '/buy/', '/buyer', '/unknown', '/__hadars/release', '/a', '/shop#hash', '/admin;param'];
    const expected = { shell: manifest.shell, snapshot: manifest.snapshot, shellInventory: output.shell, releaseId: manifest.releaseId, units: groups.map(g => ({ group: g.name, path: g.unit.file, sha256: g.unit.sha256, size: g.unit.size,
        normalizedSha256: hash(readFileSync(join(destination, g.unit.file), 'utf8').replace(manifest.releaseId, RELEASE_PLACEHOLDER)) })),
        manifestSha256: output.manifest.sha256, staticDigest: output.static.sha256, metadataSha256: output.metadataSha256,
        routingPlan: routingPlan(manifest), paths: Object.fromEntries(paths.map(p => [p, matchGroup(manifest, p)])) };
    write(join(destination, 'README.md'), `# Split conformance fixture\n\nUnits use the production minifier with legal comments and source maps disabled.\nRegenerate from the repository root with \`bun scripts/gen-split-fixture.ts\`.\nThe generator pins production settings independently of the debugging environment.\nCommit all generated files and expected literals together. Two runs must be byte-identical.\nThe platform's copied vector must be refreshed after any change to these bytes.\n\nEach miniature unit renders its group inside a main element, probes its identity,\nand embeds exactly one release global before entry scripts.\n`);
    write(join(destination, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
} finally { rmSync(scratch, { recursive: true, force: true }); }
