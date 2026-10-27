import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyExport, RELEASE_PLACEHOLDER, splitReleaseId } from '../src/composition/exportIntegrity';
import { canonical, hash } from '../src/composition/identity';
import { matchGroup, routingPlan, splitBudget } from '../src/composition/split';
const fixture = join(import.meta.dir, 'fixtures/split-export');
const metadataPath = '.hadars/static/composition-provenance.json';
const read = (root: string, file: string) => readFileSync(join(root, file));
const json = (root: string, file: string) => JSON.parse(read(root, file).toString());

test('committed conformance vector verifies every literal without regeneration', async () => {
    const expected = json(fixture, 'expected.json');
    const output = verifyExport(fixture, metadataPath, expected.metadataSha256);
    if (output.version !== 2) throw new Error('Expected split output');
    const manifest = json(fixture, output.manifest.path);
    expect(manifest.releaseId).toBe(expected.releaseId);
    expect(manifest.shell).toBe(expected.shell);
    expect(manifest.snapshot).toBe(expected.snapshot);
    expect(output.shell).toEqual(expected.shellInventory);
    expect(output.metadataSha256).toBe(expected.metadataSha256);
    expect(hash(read(fixture, output.manifest.path))).toBe(expected.manifestSha256);
    expect(output.manifest.sha256).toBe(expected.manifestSha256);
    expect(output.static.sha256).toBe(expected.staticDigest);
    expect(hash(JSON.stringify(output.static.files.map(f => [f.path, f.sha256, f.size])))).toBe(expected.staticDigest);
    expect(routingPlan(manifest)).toEqual(expected.routingPlan);
    expect(expected.units.length).toBe(manifest.groups.length);
    const normalized = [];
    for (const [i, unit] of expected.units.entries()) {
        const bytes = read(fixture, unit.path);
        const group = manifest.groups[i];
        expect(group.name).toBe(unit.group);
        expect(group.unit).toEqual({ file: unit.path, sha256: unit.sha256, size: unit.size });
        expect(output.units[i]).toEqual({ path: unit.path, sha256: unit.sha256, size: unit.size });
        expect(hash(bytes)).toBe(unit.sha256);
        expect(bytes.length).toBe(unit.size);
        const normalizedSha = hash(bytes.toString().replace(expected.releaseId, RELEASE_PLACEHOLDER));
        expect(normalizedSha).toBe(unit.normalizedSha256);
        normalized.push({ ...group, unit: { ...group.unit, sha256: normalizedSha } });
        const { default: handler } = await import(join(fixture, unit.path));
        const probe = await handler(new Request('http://local/__hadars/release'));
        expect(await probe.json()).toEqual({ release: expected.releaseId, group: unit.group, shell: manifest.shell });
        expect(probe.headers.get('cache-control')).toBe('no-store');
        expect(probe.headers.get('x-hadars-release')).toBe(expected.releaseId);
        expect(probe.headers.get('x-hadars-group')).toBe(unit.group);
        const html = await (await handler(new Request('http://local/'))).text();
        expect(html.split('__HADARS_RELEASE__').length).toBe(2);
        expect(html.indexOf('__HADARS_RELEASE__')).toBeLessThan(html.indexOf('src="/index.js"'));

    }
    expect(splitReleaseId(manifest, normalized, expected.staticDigest)).toBe(expected.releaseId);
    expect(Object.keys(expected.paths).length).toBeGreaterThanOrEqual(30);
    for (const [path, group] of Object.entries(expected.paths)) expect(matchGroup(manifest, path)).toBe(group as string);
});

function files(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(root, e.name)).map(p => e.name + '/' + p) : [e.name]);
}
for (const file of files(fixture).filter(p => p !== 'expected.json')) test(`mutating committed file fails: ${file}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'split-mutation-'));
    try {
        cpSync(fixture, dir, { recursive: true });
        const expectedError = file === metadataPath ? 'Export metadata checksum mismatch'
            : file.startsWith('.hadars/static/') ? 'Static hash mismatch:' : 'Entry script changed:';
        if (file === metadataPath) {
            const metadata = json(dir, file); metadata.shell = 'edited';
            writeFileSync(join(dir, file), JSON.stringify(metadata));
        } else writeFileSync(join(dir, file), Buffer.concat([read(dir, file), Buffer.from('\n')]));
        expect(() => verifyExport(dir, metadataPath)).toThrow(expectedError);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('budgets are required positive safe integers, sealed policy excluded from release identity', () => {
    for (const value of [undefined, null, {}, { unitBytes: 0 }, { unitBytes: -1 }, { unitBytes: 1.5 }, { unitBytes: Number.MAX_SAFE_INTEGER + 1 }, { unitBytes: '9000000' }]) {
        expect(() => splitBudget(value as any)).toThrow('SPLIT_BUDGET_INVALID');
        const dir = mkdtempSync(join(tmpdir(), 'split-budget-'));
        try {
            cpSync(fixture, dir, { recursive: true });
            const manifest = json(dir, '.hadars/split-manifest.json'); manifest.budgets = value;
            const bytes = Buffer.from(JSON.stringify(manifest));
            writeFileSync(join(dir, '.hadars/split-manifest.json'), bytes);
            const metadata = json(dir, metadataPath);
            metadata.output.manifest.sha256 = hash(bytes); metadata.output.manifest.size = bytes.length;
            const { metadataSha256, signature, ...output } = metadata.output;
            metadata.output.metadataSha256 = hash(canonical({ ...metadata, output }));
            writeFileSync(join(dir, metadataPath), JSON.stringify(metadata));
            expect(() => verifyExport(dir, metadataPath)).toThrow('SPLIT_BUDGET_INVALID');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    const manifest = json(fixture, '.hadars/split-manifest.json');
    expect(splitReleaseId(manifest, manifest.groups, 'static')).toBe(splitReleaseId({ ...manifest, budgets: { unitBytes: 1 } }, manifest.groups, 'static'));
});

test('resealed policy changes keep release identity, while tiny budgets fail verification', () => {
    const dir = mkdtempSync(join(tmpdir(), 'split-policy-'));
    try {
        cpSync(fixture, dir, { recursive: true });
        const original = json(dir, 'expected.json');
        for (const budget of [1_000_000, 1]) {
            const manifest = json(dir, '.hadars/split-manifest.json');
            manifest.budgets.unitBytes = budget;
            const bytes = Buffer.from(JSON.stringify(manifest));
            writeFileSync(join(dir, '.hadars/split-manifest.json'), bytes);
            const metadata = json(dir, metadataPath);
            metadata.output.manifest.sha256 = hash(bytes); metadata.output.manifest.size = bytes.length;
            const { metadataSha256, signature, ...output } = metadata.output;
            metadata.output.metadataSha256 = hash(canonical({ ...metadata, output }));
            writeFileSync(join(dir, metadataPath), JSON.stringify(metadata));
            expect(manifest.releaseId).toBe(original.releaseId);
            expect(metadata.output.metadataSha256).not.toBe(original.metadataSha256);
            expect(() => verifyExport(dir, metadataPath, original.metadataSha256)).toThrow('Export metadata checksum mismatch');
            if (budget === 1) expect(() => verifyExport(dir, metadataPath)).toThrow(`SPLIT_SIZE_EXCEEDED: admin: ${original.units[0].size} unit bytes > 1 budget bytes`);
            else expect(verifyExport(dir, metadataPath).version).toBe(2);
        }
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Refresh the outer checksums to exercise semantic checks independently of the seal.
function reseal(root: string) {
    const metadata = json(root, metadataPath);
    for (const f of [...metadata.output.shell, ...metadata.output.static.files]) {
        const base = f.path.startsWith('shell/') || f.path === 'hadars.lock' ? root : join(root, metadata.output.static.directory);
        const bytes = read(base, f.path); f.sha256 = hash(bytes); f.size = bytes.length;
    }
    metadata.output.static.sha256 = hash(JSON.stringify(metadata.output.static.files.map((f: any) => [f.path, f.sha256, f.size])));
    const { metadataSha256, signature, ...output } = metadata.output;
    metadata.output.metadataSha256 = hash(canonical({ ...metadata, output }));
    writeFileSync(join(root, metadataPath), JSON.stringify(metadata));
}
for (const [name, mutate, error] of [
    ['artifact', (root: string) => writeFileSync(join(root, 'shell/artifact/server/index.ssr.js'), 'edited'), 'Shell artifact hash mismatch'],
    ['manifest', (root: string) => { const m = json(root, 'shell/manifest.json'); m.buildId = 'edited'; writeFileSync(join(root, 'shell/manifest.json'), JSON.stringify(m)); }, 'Shell build identity mismatch'],
    ['snapshot', (root: string) => { const lock = json(root, 'hadars.lock'); lock.snapshotId = 'edited'; writeFileSync(join(root, 'hadars.lock'), JSON.stringify(lock)); }, 'Shell lock snapshot mismatch'],
    ['module pin', (root: string) => { const lock = json(root, 'hadars.lock'); lock.snapshot.modules.admin = lock.snapshot.modules.shop; writeFileSync(join(root, 'hadars.lock'), JSON.stringify(lock)); }, 'Duplicate lock build name'],
    ['linked pin', (root: string) => { const metadata = json(root, metadataPath); metadata.modules.admin.buildId = 'edited'; writeFileSync(join(root, metadataPath), JSON.stringify(metadata)); }, 'Shell lock module pins mismatch'],
    ['server hash', (root: string) => { const metadata = json(root, metadataPath); metadata.modules.admin.server[0].sha256 = 'edited'; writeFileSync(join(root, metadataPath), JSON.stringify(metadata)); }, 'Shell lock linked server mismatch'],
    ['client swap', (root: string) => writeFileSync(join(root, '.hadars/static/index.js'), read(root, '.hadars/static/out.html')), 'Shell client differs from static output'],
] as const) test(`self-pinned ${name} semantic verification survives resealing`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'split-shell-'));
    try {
        cpSync(fixture, dir, { recursive: true });
        mutate(dir); reseal(dir);
        expect(() => verifyExport(dir, metadataPath)).toThrow(error);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
