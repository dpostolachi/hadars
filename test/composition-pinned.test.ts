import { test, expect, afterAll } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePinnedBuilds, servePinnedAsset } from '../src/composition/pinnedBuilds';
import { loadServerModule } from '../src/composition';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const canonical = (v: any): string => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

export function pinnedFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'hadars-pinned-'));
    dirs.push(dir);
    const builds: Record<string, any> = {};
    const integrity: Record<string, string> = {};
    const ids: string[] = [];
    for (const kind of ['shell', 'module', 'library']) {
        const contents: Record<string, string> = { 'client/main.js': 'globalThis.pinnedLoaded = true;', 'client/main.css': 'body{color:red}', 'server/main.cjs': 'module.exports = { value: 42 };', 'client/chunk.js': '/* chunk */' };
        const m: any = { kind, name: kind === 'module' ? 'greeter' : kind, runtimeContract: '1', flavour: 'production',
            targets: { client: { js: ['client/main.js'], css: ['client/main.css'] }, server: { js: ['server/main.cjs'], css: [] } },
            exposes: kind === 'module' ? ['greeting'] : [], shared: [], provides: [], requires: {},
            files: Object.entries(contents).map(([path, body]) => ({ path, size: Buffer.byteLength(body), sha256: hash(body) })).sort((a, b) => a.path.localeCompare(b.path)),
        };
        m.buildId = hash(JSON.stringify(m)).slice(0, 16);
        ids.push(m.buildId);
        builds[m.buildId] = { manifest: m, sha256: hash(canonical(m)) };
        for (const [file, body] of Object.entries(contents)) {
            mkdirSync(join(dir, 'builds', m.buildId, file, '..'), { recursive: true });
            writeFileSync(join(dir, 'builds', m.buildId, file), body);
            integrity[`${m.buildId}/${file}`] = 'sha256-' + Buffer.from(hash(body), 'hex').toString('base64');
        }
    }
    const snapshot: any = { shell: ids[0], modules: { greeter: ids[1] }, libraries: { library: ids[2] } };
    snapshot.id = 'snap_' + hash(JSON.stringify(snapshot)).slice(0, 16);
    const lock = { version: 1, snapshot, snapshotId: snapshot.id, snapshotSha256: hash(canonical(snapshot)), builds };
    const options = { lockFile: join(dir, 'hadars.lock'), buildsDir: join(dir, 'builds') };
    const save = () => writeFileSync(options.lockFile, JSON.stringify(lock));
    save();
    writeFileSync(join(dir, 'integrity.json'), JSON.stringify(integrity));
    const repin = () => {
        for (const old of Object.keys(builds)) {
            const m = builds[old].manifest;
            delete m.buildId;
            m.buildId = hash(JSON.stringify({
                ...(m.types?.length ? { types: [...m.types].sort() } : {}),
                kind: m.kind, name: m.name, runtimeContract: m.runtimeContract, flavour: m.flavour,
                targets: m.targets, exposes: [...m.exposes].sort(), shared: [...m.shared].sort(), provides: [...m.provides].sort(), requires: m.requires,
                files: [...m.files].sort((a: any, b: any) => a.path.localeCompare(b.path)),
            })).slice(0, 16);
            if (old === m.buildId) continue;
            builds[m.buildId] = { manifest: m, sha256: hash(canonical(m)) };
            delete builds[old];
            renameSync(join(options.buildsDir, old), join(options.buildsDir, m.buildId));
            for (const key of Object.keys(integrity)) if (key.startsWith(old + '/')) {
                integrity[m.buildId + key.slice(old.length)] = integrity[key]!;
                delete integrity[key];
            }
            if (snapshot.shell === old) snapshot.shell = m.buildId;
            for (const pins of [snapshot.modules, snapshot.libraries]) for (const name of Object.keys(pins)) if (pins[name] === old) pins[name] = m.buildId;
        }
        snapshot.id = 'snap_' + hash(JSON.stringify({ shell: snapshot.shell, modules: snapshot.modules, libraries: snapshot.libraries })).slice(0, 16);
        lock.snapshotId = snapshot.id;
        lock.snapshotSha256 = hash(canonical(snapshot));
        save();
        writeFileSync(join(dir, 'integrity.json'), JSON.stringify(integrity));
    };
    return { dir, lock, options, save, repin, module: builds[ids[1]!].manifest };
}

test('resolves exact modules, shell and libraries without source; loads only declared server entry', async () => {
    const f = pinnedFixture();
    const builds = await resolvePinnedBuilds({ ...f.options, publicBase: 'https://assets.example/builds' });
    expect(Object.keys(builds)).toEqual(['shell', 'greeter', 'library']);
    expect(builds.greeter!.client.baseUrl).toBe(`https://assets.example/builds/${f.module.buildId}/`);
    expect(builds.greeter!.client.integrity!['client/main.js']).toStartWith('sha256-');
    expect(await loadServerModule(builds.greeter!.server)).toEqual({ value: 42 });
    expect((globalThis as any).pinnedLoaded).toBeUndefined();
});

test('serves declared client assets and chunks, never server entries or arbitrary files', async () => {
    const f = pinnedFixture();
    const builds = await resolvePinnedBuilds(f.options);
    const base = `https://example.test/_builds/${f.module.buildId}/`;
    expect(await (await servePinnedAsset(new Request(base + 'client/chunk.js'), builds))!.text()).toContain('chunk');
    expect((await servePinnedAsset(new Request(base + 'server/main.cjs'), builds))!.status).toBe(404);
    expect((await servePinnedAsset(new Request(base + 'unknown.js'), builds))!.status).toBe(404);
});

test('rejects tampered, missing and symlink files with the module name, including in dev', async () => {
    for (const mode of ['hash', 'size', 'missing', 'symlink']) {
        const f = pinnedFixture();
        await resolvePinnedBuilds(f.options, true);
        const file = join(f.options.buildsDir, f.module.buildId, 'server/main.cjs');
        if (mode === 'hash') writeFileSync(file, 'module.exports = { value: 43 };');
        if (mode === 'size') writeFileSync(file, 'x');
        if (mode === 'missing' || mode === 'symlink') rmSync(file);
        if (mode === 'symlink') symlinkSync(join(f.dir, 'hadars.lock'), file);
        await expect(resolvePinnedBuilds(f.options, true)).rejects.toThrow('"greeter"');
    }
});

test('rejects nonexact pins, corrupted metadata, wrong kinds, unsupported contracts and integrity mismatches', async () => {
    for (const mode of ['version', 'pin', 'checksum', 'kind', 'contract', 'integrity']) {
        const f = pinnedFixture();
        if (mode === 'version') f.lock.version = 2;
        if (mode === 'pin') f.lock.snapshot.modules.greeter = 'latest';
        if (mode === 'checksum') f.lock.builds[f.module.buildId].sha256 = '0'.repeat(64);
        if (mode === 'kind') f.module.kind = 'library';
        if (mode === 'contract') f.module.runtimeContract = '999';
        if (mode === 'integrity') writeFileSync(join(f.dir, 'integrity.json'), JSON.stringify({ [`${f.module.buildId}/client/main.js`]: 'sha256-wrong' }));
        f.save();
        await expect(resolvePinnedBuilds(f.options)).rejects.toThrow('Pinned build');
    }
});

test('dev override loads a running module while production keeps the pin', async () => {
    const f = pinnedFixture();
    const serverDir = join(f.dir, 'local/server');
    mkdirSync(serverDir, { recursive: true });
    mkdirSync(join(f.dir, 'local/client'));
    writeFileSync(join(serverDir, 'manifest.json'), JSON.stringify({ js: ['local.cjs'], css: [] }));
    writeFileSync(join(serverDir, 'local.cjs'), 'module.exports = { local: true };');
    writeFileSync(join(f.dir, 'local/client/manifest.json'), JSON.stringify({ js: ['local.js'], css: [] }));
    const options = { ...f.options, overrides: { greeter: { serverDir, clientUrl: 'http://localhost:1234/' } } };
    const builds = await resolvePinnedBuilds(options, true);
    expect(await loadServerModule(builds.greeter!.server)).toEqual({ local: true });
    expect(builds.greeter!.client.integrity).toBeUndefined();
    expect((await resolvePinnedBuilds(options)).greeter!.client.baseUrl).toStartWith('/_builds/');
});

test('absence of integrity map leaves files without SRI entries', async () => {
    const f = pinnedFixture();
    rmSync(join(f.dir, 'integrity.json'));
    expect((await resolvePinnedBuilds(f.options)).greeter!.client.integrity).toEqual({});
});

test('validates rechecksummed manifest metadata', async () => {
    for (const mode of ['shared', 'flavour', 'exposes', 'provides', 'path', 'entry', 'types']) {
        const f = pinnedFixture();
        if (mode === 'shared') f.module.shared = ['missing-package'];
        if (mode === 'flavour') f.module.flavour = 'dev';
        if (mode === 'exposes') f.module.exposes = ['invalid-key'];
        if (mode === 'provides') f.module.provides = ['unexpected-package'];
        if (mode === 'path') f.module.files[0].path = '../escape.js';
        if (mode === 'entry') f.module.targets.client.js = ['server/main.cjs'];
        if (mode === 'types') f.module.types = ['missing.d.ts'];
        f.repin();
        const detail = { shared: 'not provided', flavour: 'flavour', exposes: 'namespace', provides: 'only a shell', path: 'invalid file', entry: 'overlap', types: 'declaration file' }[mode]!;
        await expect(resolvePinnedBuilds(f.options, true)).rejects.toThrow(detail);
    }
});

test('a module named shell cannot hide a nonexact shell pin', async () => {
    const f = pinnedFixture();
    f.lock.snapshot.shell = '../escape';
    f.lock.snapshot.modules = { shell: f.module.buildId };
    f.save();
    await expect(resolvePinnedBuilds(f.options)).rejects.toThrow('exact build IDs');
});

test('requires an absolute URL or local path for public assets', async () => {
    for (const publicBase of ['relative', '//assets.example', '/assets?version=1', 'file:///tmp/builds', 'https://']) {
        const f = pinnedFixture();
        await expect(resolvePinnedBuilds({ ...f.options, publicBase })).rejects.toThrow('publicBase');
    }
});


test('client asset routes exclude server entries and declarations even under client/', async () => {
    const f = pinnedFixture();
    f.module.targets.server.js = ['client/chunk.js'];
    const declared = f.module.files.find((file: any) => file.path === 'client/main.css');
    renameSync(join(f.options.buildsDir, f.module.buildId, declared.path), join(f.options.buildsDir, f.module.buildId, 'client/public.d.ts'));
    declared.path = 'client/public.d.ts';
    f.module.targets.client.css = [];
    f.module.types = ['client/public.d.ts'];
    f.repin();
    const builds = await resolvePinnedBuilds(f.options);
    const base = `https://example.test/_builds/${f.module.buildId}/`;
    for (const file of ['client/chunk.js', 'client/public.d.ts']) {
        expect((await servePinnedAsset(new Request(base + file), builds))!.status).toBe(404);
    }
});

test('local override manifest errors identify the pinned module', async () => {
    const f = pinnedFixture();
    await expect(resolvePinnedBuilds({ ...f.options, overrides: { greeter: { serverDir: join(f.dir, 'missing'), clientUrl: 'http://localhost:1234/' } } }, true)).rejects.toThrow('"greeter"');
});


test('serves URL-encoded artifact names from the declared file list', async () => {
    const f = pinnedFixture();
    const file = f.module.files.find((file: any) => file.path === 'client/chunk.js');
    const special = 'client/chunk # 100%.js';
    renameSync(join(f.options.buildsDir, f.module.buildId, file.path), join(f.options.buildsDir, f.module.buildId, special));
    file.path = special;
    f.repin();
    const builds = await resolvePinnedBuilds(f.options);
    const url = `https://example.test/_builds/${f.module.buildId}/client/chunk%20%23%20100%25.js`;
    expect(await (await servePinnedAsset(new Request(url), builds))!.text()).toContain('chunk');
});
