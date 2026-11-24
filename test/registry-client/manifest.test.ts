import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateBuild } from '../../src/registry-protocol';
import { createBuildManifest } from '../../src/registry-client/manifest';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const composition = { name: 'catalog', exposes: { page: 'src/page.tsx', catalog: 'src/index.tsx' }, shared: ['react-router'] };

/** Mimics the output of hadars' buildModule. */
function fakeBuild(js = 'window.__HADARS_MODULES__.catalog={}') {
    const out = mkdtempSync(join(tmpdir(), 'platform-build-'));
    dirs.push(out);
    mkdirSync(join(out, 'client')); mkdirSync(join(out, 'server'));
    writeFileSync(join(out, 'client/catalog.js'), js);
    writeFileSync(join(out, 'client/catalog.css'), 'a{}');
    writeFileSync(join(out, 'client/manifest.json'), JSON.stringify({ js: ['catalog.js'], css: ['catalog.css'] }));
    writeFileSync(join(out, 'server/catalog.cjs'), 'module.exports={}');
    writeFileSync(join(out, 'server/manifest.json'), JSON.stringify({ js: ['catalog.cjs'], css: [] }));
    writeFileSync(join(out, 'catalog.entry.js'), '// build scratch, not published');
    return out;
}

test('describes a build with sizes, hashes and per-target file lists', () => {
    const m = createBuildManifest({ outDir: fakeBuild(), composition });
    expect(m.kind).toBe('module');
    expect(m.exposes).toEqual(['catalog', 'page']);
    expect(m.shared).toEqual(['react-router']);
    expect(m.targets.client).toEqual({ js: ['client/catalog.js'], css: ['client/catalog.css'] });
    expect(m.targets.server.js).toEqual(['server/catalog.cjs']);
    const js = m.files.find((f) => f.path === 'client/catalog.js')!;
    expect(js.size).toBe('window.__HADARS_MODULES__.catalog={}'.length);
    expect(js.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(validateBuild(m)).toEqual([]);
});

test('build scratch files are not published', () => {
    const m = createBuildManifest({ outDir: fakeBuild(), composition });
    expect(m.files.map((f) => f.path)).toEqual(['client/catalog.css', 'client/catalog.js', 'client/manifest.json', 'server/catalog.cjs', 'server/manifest.json']);
});

test('the build ID depends on content only: same bytes same ID, one byte different, new ID', () => {
    const a = createBuildManifest({ outDir: fakeBuild(), composition });
    const b = createBuildManifest({ outDir: fakeBuild(), composition });
    const c = createBuildManifest({ outDir: fakeBuild('window.__HADARS_MODULES__.catalog={x:1}'), composition });
    expect(a.buildId).toBe(b.buildId);
    expect(c.buildId).not.toBe(a.buildId);
});

test('the flavour is part of the identity', () => {
    const out = fakeBuild();
    expect(createBuildManifest({ outDir: out, composition, flavour: 'dev' }).buildId)
        .not.toBe(createBuildManifest({ outDir: out, composition }).buildId);
});

test('a missing build says what to do', () => {
    const empty = mkdtempSync(join(tmpdir(), 'platform-empty-'));
    dirs.push(empty);
    expect(() => createBuildManifest({ outDir: empty, composition })).toThrow('Run the module build first');
});

test('an invalid module name is reported by the validator', () => {
    const m = createBuildManifest({ outDir: fakeBuild(), composition: { ...composition, name: '@scope/x' } });
    expect(validateBuild(m)[0].message).toContain('invalid name');
});

test('declaration files in types/ are published with the build and listed', () => {
    const out = fakeBuild();
    mkdirSync(join(out, 'types'));
    writeFileSync(join(out, 'types/page.d.ts'), 'export declare const Page: () => null;');
    writeFileSync(join(out, 'types/notes.txt'), 'not a declaration');
    const m = createBuildManifest({ outDir: out, composition });
    expect(m.types).toEqual(['types/page.d.ts']);
    expect(m.files.map((f) => f.path)).toContain('types/page.d.ts');
    expect(m.files.map((f) => f.path)).not.toContain('types/notes.txt');
    expect(validateBuild(m)).toEqual([]);
    expect(createBuildManifest({ outDir: fakeBuild(), composition }).types).toBeUndefined();
});
