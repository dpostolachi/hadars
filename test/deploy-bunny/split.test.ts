import { test, expect } from 'bun:test';
import { loadArtifact } from '../../src/deploy/bunny/artifact';
import { verifyOutput } from '../../src/deploy/bunny/output';
import { splitStatic, matchGroup, routingPlan, rulePatterns, wildcardMatch, type SplitManifest } from '../../src/deploy/bunny/split';
const root = import.meta.dir + '/fixtures/split-export';
const expected = await Bun.file(root + '/expected.json').json();
const artifact = await loadArtifact(root);
const manifest = JSON.parse(new TextDecoder().decode(artifact.files.find(f => f.path === '.hadars/split-manifest.json')!.bytes)) as SplitManifest;
test('producer literal conformance vector: identity, every final/normalized hash and seal', () => {
    const result = verifyOutput(artifact);
    expect(manifest.shell).toBe(expected.shell);
    expect(manifest.snapshot).toBe(expected.snapshot);
    expect(artifact.nativeProvenance!.shell).toBe(expected.shell);
    expect(artifact.nativeProvenance!.snapshot).toBe(expected.snapshot);
    expect((artifact.nativeProvenance as any).output.shell).toEqual(expected.shellInventory);
    expect(result.split?.releaseId).toBe(expected.releaseId);
    expect(result.split?.units).toEqual(expected.units);
    expect(result.split?.manifestSha256).toBe(expected.manifestSha256);
    expect(result.staticSha256).toBe(expected.staticDigest);
    expect(result.metadataSha256).toBe(expected.metadataSha256);
    expect(routingPlan(manifest)).toEqual(expected.routingPlan);
});
test('native full URL patterns agree with all literal path witnesses and query boundaries', () => {
    for (const [path, group] of Object.entries(expected.paths)) {
        const native = manifest.groups.find(g => rulePatterns(g.patterns, 'local.example').some(p => wildcardMatch(p, 'https://local.example' + path)))?.name ?? manifest.defaultGroup;
        expect(native, path).toBe(group as string); expect(matchGroup(manifest, path)).toBe(group as string);
    }
    for (const path of ['/admin', '/admin/', '/admin/x', '/admin?x=1', '/admin/x?y=2']) expect(rulePatterns(['/admin/**'], 'local.example').some(p => wildcardMatch(p, 'https://local.example' + path)), path).toBe(true);
    for (const path of ['/administrator', '/admin2', '/ADMIN', '/x/admin', '/?next=/admin', '/x?next=/admin']) expect(rulePatterns(['/admin/**'], 'local.example').some(p => wildcardMatch(p, 'https://local.example' + path)), path).toBe(false);
    for (const path of ['/', '/?x=1']) expect(rulePatterns(['/'], 'local.example').some(p => wildcardMatch(p, 'https://local.example' + path))).toBe(true);
    for (const path of ['/x', '//', '/x?next=/']) expect(rulePatterns(['/'], 'local.example').some(p => wildcardMatch(p, 'https://local.example' + path))).toBe(false);
});

import { outputHash, outputCanonical } from '../../src/deploy/bunny/output';
import { resealSplit } from './helpers/split';
import { mkdtemp, cp, rm, symlink } from 'node:fs/promises';
const errorMessage = (a: typeof artifact) => { try { verifyOutput(a); return ''; } catch (e) { return (e as Error).message; } };
const changed = (path: string, old: Uint8Array, bytes: Uint8Array) => `Entry script changed: ${path} (expected ${outputHash(old)}/${old.length}, actual ${outputHash(bytes)}/${bytes.length})`;
test('every unit mutation gives exact changed-file and release-identity differences', () => {
    for (const unit of expected.units) {
        const a = structuredClone(artifact), file = a.files.find(f => f.path === unit.path)!;
        const original = file.bytes; file.bytes = Buffer.concat([original, Buffer.from('\n')]);
        expect(errorMessage(a)).toBe('Export verification failed:\n' + changed(file.path, original, file.bytes) + '\nSplit output invalid: Split release identity mismatch');
        const missing = structuredClone(artifact); missing.files = missing.files.filter(f => f.path !== unit.path);
        expect(errorMessage(missing)).toBe(`Export verification failed:\nMissing entry script: ${unit.path}`);
    }
});
test('manifest bytes, metadata checksum, missing/extra/changed static and extra unit differences', () => {
    const a = structuredClone(artifact), manifestFile = a.files.find(f => f.path === '.hadars/split-manifest.json')!;
    const original = manifestFile.bytes;
    const m = JSON.parse(new TextDecoder().decode(original)); m.budgets.unitBytes++;
    manifestFile.bytes = Buffer.from(JSON.stringify(m));
    expect(errorMessage(a)).toBe('Export verification failed:\n' + changed(manifestFile.path, original, manifestFile.bytes));
    const metadata = a.files.find(f => f.path === 'composition-provenance.json')!;
    const provenance = JSON.parse(new TextDecoder().decode(metadata.bytes)); provenance.shell = 'changed'; metadata.bytes = Buffer.from(JSON.stringify(provenance));
    expect(errorMessage(a)).toBe('Export metadata checksum mismatch');
    const extra = structuredClone(artifact); extra.files.push({ path: 'units/foreign/bunny.mjs', bytes: Buffer.from('extra') });
    expect(errorMessage(extra)).toBe('Export verification failed:\nExtra unit: units/foreign/bunny.mjs');
    for (const file of artifact.files.filter(f => splitStatic(f) && f.path !== 'composition-provenance.json')) {
        const missing = structuredClone(artifact); missing.files = missing.files.filter(f => f.path !== file.path);
        expect(errorMessage(missing)).toContain(`Missing static file: ${file.path}`);
        expect(errorMessage(missing)).toContain('Static output digest mismatch');
        const modified = structuredClone(artifact), f = modified.files.find(f => f.path === file.path)!; f.bytes = Buffer.from('changed');
        expect(errorMessage(modified)).toContain(`Static hash mismatch: ${f.path} (expected ${outputHash(file.bytes)}/${file.bytes.length}, actual ${outputHash(f.bytes)}/${f.bytes.length})`);
        expect(errorMessage(modified)).toContain('Static output digest mismatch');
    }
    const staticExtra = structuredClone(artifact); staticExtra.files.push({ path: 'extra.txt', bytes: Buffer.from('extra') });
    expect(errorMessage(staticExtra)).toBe('Export verification failed:\nExtra static file: extra.txt\nStatic output digest mismatch');
});
test('resealed invalid grammar, nested mounts, membership/order, budget and embedded release are refused', () => {
    for (const [mutate, message] of [
        [(m: any) => { m.groups[0].patterns = ['/admin/*']; }, 'SPLIT_PATTERN_INVALID'],
        [(m: any) => { m.groups[1].patterns = ['/admin/x']; }, 'SPLIT_PATTERN_NESTED: /admin/** (admin) and /admin/x (shop)'],
        [(m: any) => { m.groups.reverse(); }, 'SPLIT_GROUP_ORDER'],
        [(m: any) => { m.groups[0].modules = ['shop']; }, 'Invalid split unit membership: admin'],
        [(m: any) => { m.budgets.unitBytes = 0; }, 'SPLIT_BUDGET_INVALID'],
        [(m: any) => { m.budgets.unitBytes = expected.units[0].size - 1; }, `SPLIT_SIZE_EXCEEDED: admin: ${expected.units[0].size} unit bytes > ${expected.units[0].size - 1} budget bytes`],
        [(m: any, _md: any, a: typeof artifact) => { m.budgets.unitBytes = Math.max(...expected.units.map((u: any) => u.size)); const f = a.files.find(f => f.path === 'units/main/bunny.mjs')!; f.bytes = Buffer.from(new TextDecoder().decode(f.bytes) + '// ' + 'x'.repeat(1000)); }, 'SPLIT_SIZE_EXCEEDED: main'],
    ] as const) expect(errorMessage(resealSplit(artifact, mutate))).toContain(message);
    const double = structuredClone(artifact), duplicate = double.files.find(f => f.path === manifest.groups[0].unit.file)!;
    duplicate.bytes = Buffer.from(new TextDecoder().decode(duplicate.bytes) + `// ${manifest.releaseId}`);
    expect(errorMessage(double)).toContain('Invalid embedded release: admin');
    const wrong = resealSplit(artifact, m => { m.shell = 'wrong'; });
    // resealSplit changes manifest identity but not provenance or runtime composition.
    expect(errorMessage(wrong)).toContain('Split manifest composition identity mismatch');
});
test('metadata extensions participate in checksum; signature is explicitly excluded', () => {
    const a = structuredClone(artifact), f = a.files.find(f => f.path === 'composition-provenance.json')!;
    const md = JSON.parse(new TextDecoder().decode(f.bytes)); md.output.signature = { reserved: true }; f.bytes = Buffer.from(JSON.stringify(md));
    expect(verifyOutput(a).metadataSha256).toBe(expected.metadataSha256);
    md['é'] = { z: 1, a: 2 }; f.bytes = Buffer.from(JSON.stringify(md));
    expect(errorMessage(a)).toBe('Export metadata checksum mismatch');
    const { metadataSha256, signature, ...rest } = md.output;
    md.output.metadataSha256 = outputHash(outputCanonical({ ...md, output: rest })); f.bytes = Buffer.from(JSON.stringify(md));
    expect(verifyOutput(a).metadataSha256).toBe(md.output.metadataSha256);
});
test('loader refuses symlinks in unit, manifest and static inventories', async () => {
    for (const path of ['units/admin/bunny.mjs', 'units/admin', '.hadars/split-manifest.json', '.hadars/static/out.html', 'shell', 'shell/artifact/client', 'shell/manifest.json', 'hadars.lock']) {
        const temp = await mkdtemp('/tmp/split-symlink-');
        try {
            await cp(root, temp, { recursive: true }); await rm(temp + '/' + path, { recursive: true });
            await symlink(root + '/' + path, temp + '/' + path);
            await expect(loadArtifact(temp)).rejects.toThrow(/symlink|unsupported/);
        } finally { await rm(temp, { recursive: true, force: true }); }
    }
});

test('shared static names cannot be confused with unit/control paths', async () => {
    const { outputDigest } = await import('../../src/deploy/bunny/output');
    const { staticLayout } = await import('../../src/deploy/bunny/layout');
    const a = resealSplit(artifact, (_m, md, files) => {
        const bytes = Buffer.from('public static content');
        files.files.push({ role: 'static', path: 'units/main/bunny.mjs', bytes });
        md.output.static.files.push({ path: 'units/main/bunny.mjs', sha256: outputHash(bytes), size: bytes.length });
        md.output.static.files.sort((a: any, b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        md.output.static.sha256 = outputDigest(md.output.static.files);
    });
    expect(verifyOutput(a).split!.units).toHaveLength(3);
    const files = staticLayout(a).files.filter(f => f.path.endsWith('/units/main/bunny.mjs'));
    expect(files).toHaveLength(1); expect(new TextDecoder().decode(files[0].bytes)).toBe('public static content');
});


test('concrete host translation preserves measured boundaries for every zone hostname', () => {
    expect(wildcardMatch('https://*/admin', 'https://demo.b-cdn.net/x/admin')).toBe(true);
    expect(rulePatterns(['/control'], 'a.example')).toEqual(['https://a.example/control']);
    for (const host of ['demo.b-cdn.net', 's1.bunny.run', 'a.example', 'b.example', 'c.example', 'd.example', 'e.example']) {
        const patterns = rulePatterns(['/admin/**'], host);
        expect(patterns).toEqual([`https://${host}/admin`, `https://${host}/admin/*`]);
        for (const path of ['/admin', '/admin/', '/admin/x', '/admin?x=1', '/admin/x?y=2']) expect(patterns.some(p => wildcardMatch(p, `https://${host}${path}`)), host + path).toBe(true);
        for (const path of ['/administrator', '/admin2', '/ADMIN', '/x/admin', '/?next=/admin', '/x?next=/admin']) expect(patterns.some(p => wildcardMatch(p, `https://${host}${path}`)), host + path).toBe(false);
        for (const [path, group] of Object.entries(expected.paths)) expect(manifest.groups.find(g => rulePatterns(g.patterns, host).some(p => wildcardMatch(p, `https://${host}${path}`)))?.name ?? manifest.defaultGroup).toBe(group as string);
    }
    for (const host of ['', 'invalid', '*.example', 'https://a.example', 'a.example/x', 'a..example', '-a.example', 'a.example?x', '**', '*']) expect(() => rulePatterns(['/admin/**'], host)).toThrow('Invalid routing hostname');
});

test('literal units inject the release global and enforce selectors before application work', async () => {
    for (const unit of expected.units) {
        const code = new TextDecoder().decode(artifact.files.find(f => f.path === unit.path)!.bytes);
        expect(code.split(expected.releaseId)).toHaveLength(2);
        const handler = (await import(root + '/' + unit.path)).default;
        const html = await handler(new Request('http://127.0.0.1/page'));
        const body = await html.text();
        const global = `globalThis.__HADARS_RELEASE__ = ${JSON.stringify({ release: expected.releaseId, group: unit.group })}`;
        expect(body.split(global)).toHaveLength(2);
        expect(body.indexOf(global)).toBeLessThan(body.indexOf('<script src="/index.js">'));
        expect(html.headers.get('x-hadars-release')).toBe(expected.releaseId);
        expect(html.headers.get('x-hadars-group')).toBe(unit.group);
        const probe = await handler(new Request('http://127.0.0.1/__hadars/release?x=1', { headers: { 'x-hadars-release-selector': 'invalid' } }));
        expect(await probe.json()).toEqual({ release: expected.releaseId, group: unit.group, shell: expected.shell });
        for (const method of ['GET', 'POST']) {
            const mismatch = await handler(new Request('http://127.0.0.1/page', { method, headers: { 'x-hadars-release-selector': '0'.repeat(16) } }));
            expect(mismatch.status).toBe(409);
            expect(mismatch.headers.get('cache-control')).toBe('no-store');
            expect(await mismatch.json()).toEqual({ error: 'SPLIT_RELEASE_MISMATCH', expected: expected.releaseId, received: '0'.repeat(16), group: unit.group });
            const invalid = await handler(new Request('http://127.0.0.1/page', { method, headers: { 'x-hadars-release-selector': 'invalid' } }));
            expect(invalid.status).toBe(400);
            expect(await invalid.json()).toEqual({ error: 'SPLIT_RELEASE_SELECTOR_INVALID' });
            expect((await handler(new Request('http://127.0.0.1/page', { method, headers: { 'x-hadars-release-selector': expected.releaseId } }))).status).toBe(200);
        }
    }
});

test('every self-pinned file is sealed and missing/changed/extra shell files fail', () => {
    for (const pin of expected.shellInventory) {
        const changed = structuredClone(artifact), file = changed.files.find(f => f.path === pin.path)!;
        file.bytes = Buffer.from('tampered');
        expect(errorMessage(changed)).toContain(`Entry script changed: ${pin.path}`);
        const missing = structuredClone(artifact); missing.files = missing.files.filter(f => f.path !== pin.path);
        expect(errorMessage(missing)).toContain(`Missing entry script: ${pin.path}`);
    }
    const extra = structuredClone(artifact); extra.files.push({ role: 'pin', path: 'shell/artifact/server/extra.js', bytes: Buffer.from('extra') });
    expect(errorMessage(extra)).toContain('Shell inventory mismatch');
});

// Re-seal changed pin bytes to reach the semantic parity checks beyond the seal.
function resealPins(mutate: (a: typeof artifact, md: any) => void) {
    return resealSplit(artifact, (_m, md, a) => {
        mutate(a, md);
        md.output.shell = md.output.shell.map((pin: any) => {
            const file = a.files.find(f => f.path === pin.path)!;
            return { path: pin.path, size: file.bytes.length, sha256: outputHash(file.bytes) };
        });
    });
}
test('resealing cannot bypass shell build identity, artifact, client parity, lock or module pins', () => {
    const json = (a: typeof artifact, path: string, change: (value: any) => void) => {
        const f = a.files.find(f => f.path === path)!;
        const value = JSON.parse(new TextDecoder().decode(f.bytes)); change(value); f.bytes = Buffer.from(JSON.stringify(value));
    };
    expect(errorMessage(resealPins(a => json(a, 'shell/manifest.json', m => { m.name = 'wrong'; })))).toContain('Shell build identity mismatch');
    expect(errorMessage(resealPins(a => { a.files.find(f => f.path === 'shell/artifact/server/index.ssr.js')!.bytes = Buffer.from('changed'); }))).toContain('Shell artifact hash mismatch');
    expect(errorMessage(resealPins((a, md) => {
        const file = a.files.find(f => f.path === 'out.html' && f.role === 'static')!; file.bytes = Buffer.from('changed');
        md.output.static.files = md.output.static.files.map((f: any) => f.path === file.path ? { path: f.path, size: file.bytes.length, sha256: outputHash(file.bytes) } : f);
        md.output.static.sha256 = outputHash(JSON.stringify(md.output.static.files.map((f: any) => [f.path, f.sha256, f.size])));
    }))).toContain('Shell client differs from static output');
    expect(errorMessage(resealPins(a => json(a, 'hadars.lock', l => { l.snapshotId = 'wrong'; })))).toContain('Shell lock snapshot mismatch');
    expect(errorMessage(resealPins((_a, md) => { md.modules.admin.buildId = 'wrong'; }))).toContain('Shell lock module pins mismatch');
    expect(errorMessage(resealPins((_a, md) => { md.modules.admin.server[0].sha256 = '0'.repeat(64); }))).toContain('Shell lock linked server mismatch');
});

test('older seal-v2 exports without self-pin inventory remain supported; zero embedded ids fail', () => {
    const old = resealSplit(artifact, (_m, md, a) => { delete md.output.shell; a.files = a.files.filter(f => f.role !== 'pin'); });
    expect(verifyOutput(old).split!.releaseId).toBe(expected.releaseId);
    const zero = structuredClone(artifact), unit = zero.files.find(f => f.path === expected.units[0].path)!;
    unit.bytes = Buffer.from(new TextDecoder().decode(unit.bytes).replace(expected.releaseId, '0'.repeat(16)));
    expect(errorMessage(zero)).toContain('Invalid embedded release: admin');
});
