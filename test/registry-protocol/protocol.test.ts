import { test, expect } from 'bun:test';
import { buildIdFor, validateBuild, validateSnapshot, type BuildManifest } from '../../src/registry-protocol';

const withId = (m: BuildManifest): BuildManifest => ({ ...m, buildId: buildIdFor(m) });
const build = (over: Partial<BuildManifest> = {}): BuildManifest => withId({
    kind: 'module', name: 'catalog', buildId: '', runtimeContract: '1', flavour: 'production',
    targets: { client: { js: ['c.js'], css: [] }, server: { js: ['s.cjs'], css: [] } },
    exposes: ['catalog'], shared: [], provides: [], requires: { react: '^19.0.0' },
    files: [{ path: 'c.js', size: 1, sha256: 'a'.repeat(64) }, { path: 's.cjs', size: 1, sha256: 'b'.repeat(64) }],
    ...over,
});
const shell = (over: Partial<BuildManifest> = {}) => build({ kind: 'shell', name: 'shell', exposes: [], ...over });
const snapshotOf = (s: BuildManifest, m: BuildManifest) => ({ id: 'x', shell: s.buildId, modules: { [m.name]: m.buildId }, libraries: {} });
const run = (m: BuildManifest, s = shell()) => validateSnapshot(snapshotOf(s, m), { [s.buildId]: s, [m.buildId]: m });

test('a consistent build has no issues', () => expect(validateBuild(build())).toEqual([]));

test('manifest files must be declared', () => {
    const b = build({ targets: { client: { js: ['missing.js'], css: [] }, server: { js: [], css: [] } } });
    expect(validateBuild(b)[0].message).toContain('missing.js');
});

test('names and exposes keys must be usable in generated output', () => {
    expect(validateBuild(build({ name: '@scope/x' }))[0].message).toContain('invalid name');
    expect(validateBuild(build({ exposes: ['my-page'] }))[0].message).toContain('not a valid identifier');
    expect(validateBuild(build({ exposes: [] }))[0].message).toContain('at least one');
});

test('only a shell may provide packages', () => {
    expect(validateBuild(build({ provides: ['react-router'] }))[0].path).toBe('provides');
    expect(validateBuild(shell({ provides: ['react-router'] }))).toEqual([]);
});

test('module with a different runtime contract fails snapshot validation', () => {
    expect(run(build({ runtimeContract: '2', provides: {} }))[0].message).toContain('runtime contract');
});

test('a module needing a package the shell does not provide is rejected', () => {
    const issues = run(build({ shared: ['react-router'] }));
    expect(issues).toEqual([{ path: 'modules.catalog', message: 'needs "react-router", which the shell does not provide' }]);
});

test('React is implicitly provided, other packages come from the shell', () => {
    const m = build({ shared: ['react', 'react/jsx-runtime', 'react-router'] });
    expect(run(m, shell({ provides: ['react-router'] }))).toEqual([]);
});

test('a snapshot slot must hold the module it is named after', () => {
    const m = build({ name: 'checkout' });
    const s = shell();
    const issues = validateSnapshot({ id: 'x', shell: s.buildId, modules: { catalog: m.buildId }, libraries: {} }, { [s.buildId]: s, [m.buildId]: m });
    expect(issues[0].message).toContain('not "catalog"');
});

test('a build ID that does not match the content is rejected', () => {
    expect(validateBuild({ ...build(), buildId: 'forged' })[0].message).toContain('does not match');
});

test('the build ID ignores list order', () => {
    const a = build({ exposes: ['a', 'b'], shared: ['x', 'y'] });
    const b = withId({ ...a, exposes: ['b', 'a'], shared: ['y', 'x'], files: [...a.files].reverse() });
    expect(a.buildId).toBe(b.buildId);
});

test('data that is not a manifest is reported, not thrown on', () => {
    expect(validateBuild(null)[0].message).toContain('JSON object');
    expect(validateBuild({ hello: 'world' }).length).toBeGreaterThan(3);
    expect(validateBuild({ ...build(), files: [{ path: 'a', size: -1, sha256: 'x' }] })[0].path).toBe('files');
    expect(validateBuild({ ...build(), targets: {} }).some((i) => i.path === 'targets.client')).toBe(true);
    expect(validateBuild({ ...build(), exposes: 'catalog' })[0].path).toBe('exposes');
});

test('declaration files must be .d.ts and listed in files', () => {
    const base = build();
    const withFile = { ...base, files: [...base.files, { path: 'types/page.d.ts', size: 3, sha256: 'a'.repeat(64) }] };
    const ok = { ...withFile, types: ['types/page.d.ts'] };
    expect(validateBuild({ ...ok, buildId: buildIdFor(ok) })).toEqual([]);
    const missing = { ...base, types: ['types/gone.d.ts'] };
    expect(validateBuild({ ...missing, buildId: buildIdFor(missing) }).map((i) => i.message)).toEqual(['types/gone.d.ts is not in files']);
    const wrong = { ...withFile, types: ['client/a.js'] };
    expect(validateBuild({ ...wrong, buildId: buildIdFor(wrong) }).map((i) => i.message)).toEqual(['client/a.js is not a .d.ts file']);
});

test('declarations change the build ID, and builds without them keep theirs', () => {
    const base = build();
    expect(buildIdFor({ ...base, types: [] })).toBe(buildIdFor(base));
    expect(buildIdFor({ ...base, types: ['types/a.d.ts'] })).not.toBe(buildIdFor(base));
});

test('mounts, routes and uses change the build ID; builds without them keep theirs', () => {
    const plain = build();
    expect(build({ mounts: undefined }).buildId).toBe(plain.buildId);
    const mounted = build({ mounts: ['/catalog/**'] });
    expect(mounted.buildId).not.toBe(plain.buildId);
    expect(build({ mounts: ['/catalog/**'], uses: ['badge'] }).buildId).not.toBe(mounted.buildId);
    expect(build({ mounts: ['/b', '/a'] }).buildId).toBe(build({ mounts: ['/a', '/b'] }).buildId);
    expect(validateBuild(mounted)).toEqual([]);
});

test('ownership fields are validated', () => {
    expect(validateBuild(build({ mounts: ['/a/*'] }))[0].message).toContain('literal path');
    expect(validateBuild(build({ mounts: ['/a', '/a'] }))[0].message).toContain('duplicate');
    expect(validateBuild(build({ routes: 'catalog' }))[0].message).toContain('needs mounts');
    expect(validateBuild(build({ mounts: ['/a'], routes: 'nope' }))[0].message).toContain('not an exposed namespace');
    expect(validateBuild(build({ uses: ['catalog'] }))[0].message).toContain('cannot use itself');
    expect(validateBuild(build({ kind: 'shell', name: 'shell', exposes: [], mounts: ['/a'] }))[0].path).toBe('mounts');
});

test('a snapshot must contain the modules a module uses, without cycles', () => {
    const s = shell();
    const catalog = build({ uses: ['badge'] });
    expect(run(catalog, s).map((i) => i.message)).toEqual([expect.stringContaining('uses "badge"')]);
    const badge = build({ name: 'badge', exposes: ['badge'], uses: ['catalog'] });
    const cyc = validateSnapshot({ id: 'x', shell: s.buildId, modules: { catalog: catalog.buildId, badge: badge.buildId }, libraries: {} },
        { [s.buildId]: s, [catalog.buildId]: catalog, [badge.buildId]: badge });
    expect(cyc.map((i) => i.message).join(' ')).toContain('cycle');
    const ok = build({ name: 'badge', exposes: ['badge'] });
    expect(validateSnapshot({ id: 'x', shell: s.buildId, modules: { catalog: catalog.buildId, badge: ok.buildId }, libraries: {} },
        { [s.buildId]: s, [catalog.buildId]: catalog, [ok.buildId]: ok })).toEqual([]);
});
