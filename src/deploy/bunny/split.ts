import { buildIdFor, snapshotIdFor, assertNativeLockCompatibility, type BuildManifest } from './identity';
import type { Artifact, ArtifactFile, LinkedFile } from './index';
import { dnsHostname } from './zones';
import { outputCanonical, outputDigest, outputHash, type OutputVerification } from './output';

export const splitUnit = (f: ArtifactFile) => f.role === 'unit' || f.role === undefined && f.path.startsWith('units/');
export const splitManifestFile = (f: ArtifactFile) => f.role === 'manifest' || f.role === undefined && f.path === '.hadars/split-manifest.json';
export const splitPin = (f: ArtifactFile) => f.role === 'pin' || f.role === undefined && (f.path.startsWith('shell/') || f.path === 'hadars.lock');
export const splitStatic = (f: ArtifactFile) => f.path !== 'composition-provenance.json' && (f.role === 'static' || !splitPin(f) && !splitUnit(f) && !splitManifestFile(f));

export interface SplitGroup { name: string; patterns: string[]; modules: string[]; unit: { file: string; sha256: string; size: number } }
export interface SplitManifest {
    version: 1; mode: 'per-module'; releaseId: string; defaultGroup: string; shell: string; snapshot: string;
    probe: { path: '/__hadars/release' }; budgets: { unitBytes: number }; groups: SplitGroup[];
}
export interface SplitOutput { version: 2; shell?: LinkedFile[]; units: LinkedFile[]; manifest: LinkedFile; static: { directory: string; files: LinkedFile[]; sha256: string }; metadataSha256: string; signature?: unknown }
export const splitName = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/.test(s) && s !== '.' && s !== '..';
export const literalPrefix = (p: string) => p.endsWith('/**') ? p.slice(0, -3) : p;
export const routingPlan = (m: SplitManifest) => m.groups.map(g => ({ group: g.name, patterns: [...g.patterns] }));
export function matchGroup(m: Pick<SplitManifest, 'groups' | 'defaultGroup'>, pathname: string): string {
    const path = pathname.split(/[?#]/, 1)[0]!;
    return m.groups.find(g => g.patterns.some(p => path === literalPrefix(p) || p.endsWith('/**') && path.startsWith(literalPrefix(p) + '/')))?.name ?? m.defaultGroup;
}
export function validateSplit(m: SplitManifest): void {
    if (!m || m.version !== 1 || m.mode !== 'per-module' || !/^[a-f0-9]{16}$/.test(m.releaseId) || typeof m.shell !== 'string' || typeof m.snapshot !== 'string' || m.probe?.path !== '/__hadars/release' || !Array.isArray(m.groups)) throw new Error('Invalid split manifest');
    if (!splitName(m.defaultGroup)) throw new Error('SPLIT_DEFAULT_INVALID');
    if (!Number.isSafeInteger(m.budgets?.unitBytes) || m.budgets.unitBytes < 1) throw new Error('SPLIT_BUDGET_INVALID');
    const names = new Set<string>(), patterns: { p: string; group: string }[] = [];
    for (const g of m.groups) {
        if (!splitName(g.name) || names.has(g.name)) throw new Error('SPLIT_GROUP_INVALID'); names.add(g.name);
        if (!Array.isArray(g.patterns) || (g.name === m.defaultGroup ? g.patterns.length !== 0 : !g.patterns.length)) throw new Error('SPLIT_PATTERNS_INVALID');
        for (const p of g.patterns) {
            if (typeof p !== 'string' || !/^(?:\/|\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*(?:\/\*\*)?)$/.test(p)) throw new Error('SPLIT_PATTERN_INVALID');
            for (const old of patterns) {
                const a = literalPrefix(old.p), b = literalPrefix(p);
                if (old.group !== g.name && (a === b || a === '/' || b === '/' || a.startsWith(b + '/') || b.startsWith(a + '/'))) throw new Error(`SPLIT_PATTERN_NESTED: ${old.p} (${old.group}) and ${p} (${g.name})`);
            }
            patterns.push({ p, group: g.name });
        }
    }
    if (!names.has(m.defaultGroup)) throw new Error('SPLIT_DEFAULT_MISSING');
    const length = (g: SplitGroup) => Math.max(0, ...g.patterns.map(p => literalPrefix(p).length));
    const sorted = m.groups.filter(g => g.name !== m.defaultGroup).sort((a, b) => length(b) - length(a) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    sorted.push(m.groups.find(g => g.name === m.defaultGroup)!);
    if (sorted.some((g, i) => g !== m.groups[i])) throw new Error('SPLIT_GROUP_ORDER');
}

/** CDN glob simulation: '*' consumes any characters, including '/'. Queries are ignored. */
export function wildcardMatch(pattern: string, url: string): boolean {
    const glob = pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp('^' + glob + '$').test(url.split(/[?#]/, 1)[0]!);
}
export function rulePatterns(patterns: string[], hostname: string): string[] {
    if (!dnsHostname(hostname)) throw new Error('Invalid routing hostname');
    return patterns.flatMap(p => {
        const base = `https://${hostname}${literalPrefix(p)}`;
        return p.endsWith('/**') ? [base, base + '/*'] : [base];
    });
}

const fileOK = (f: LinkedFile) => f && typeof f.path === 'string' && !!f.path && !/[\\\0]/.test(f.path) && !f.path.split('/').some(p => !p || p === '.' || p === '..') && /^[a-f0-9]{64}$/.test(f.sha256) && Number.isSafeInteger(f.size) && f.size >= 0;
export function verifySplitOutput(artifact: Artifact, trustedChecksum?: string): OutputVerification {
    const metadata = JSON.parse(new TextDecoder().decode(artifact.files.find(f => f.path === 'composition-provenance.json')?.bytes));
    const output = metadata?.output as SplitOutput;
    if (!output || output.version !== 2) throw new Error('Export metadata missing or unsupported output version');
    const { metadataSha256, signature, ...rest } = output;
    const checksum = outputHash(outputCanonical({ ...metadata, output: rest }));
    if (checksum !== metadataSha256 || trustedChecksum !== undefined && checksum !== trustedChecksum) throw new Error('Export metadata checksum mismatch');
    if (output.shell !== undefined && (!Array.isArray(output.shell) || !output.shell.every(fileOK)) || !Array.isArray(output.units) || !output.units.every(fileOK) || !fileOK(output.manifest) || output.manifest.path !== '.hadars/split-manifest.json' || output.static?.directory !== '.hadars/static' || !Array.isArray(output.static.files) || !output.static.files.every(fileOK)) throw new Error('Invalid export output records');
    const differences: string[] = [], seen = new Set<string>();
    for (const f of [...output.units, output.manifest, ...(output.shell ?? [])]) {
        if (seen.has(f.path)) throw new Error(`Duplicate output file: ${f.path}`); seen.add(f.path);
        const actual = artifact.files.find(a => a.path === f.path && a.role !== 'static');
        if (!actual) differences.push(`Missing entry script: ${f.path}`);
        else if (outputHash(actual.bytes) !== f.sha256 || actual.bytes.length !== f.size) differences.push(`Entry script changed: ${f.path} (expected ${f.sha256}/${f.size}, actual ${outputHash(actual.bytes)}/${actual.bytes.length})`);
    }
    for (const f of artifact.files.filter(splitUnit)) if (!seen.has(f.path)) differences.push(`Extra unit: ${f.path}`);
    let manifest: SplitManifest | undefined;
    const normalizedUnits: { group: string; path: string; sha256: string; size: number; normalizedSha256: string }[] = [];
    try {
        manifest = JSON.parse(new TextDecoder().decode(artifact.files.find(splitManifestFile)?.bytes));
        validateSplit(manifest!);
        const m = manifest!;
        if (m.shell !== metadata.shell || m.snapshot !== metadata.snapshot) throw new Error('Split manifest composition identity mismatch');
        if (outputCanonical(m.groups.map(g => ({ path: g.unit?.file, sha256: g.unit?.sha256, size: g.unit?.size }))) !== outputCanonical(output.units)) throw new Error('Split manifest units differ from seal');
        const mounted = new Set<string>();
        for (const g of m.groups) {
            if (g.unit.file !== `units/${g.name}/bunny.mjs` || !Array.isArray(g.modules) || outputCanonical(g.modules) !== outputCanonical(g.name === m.defaultGroup ? [] : [g.name]) || g.modules.some(n => !Object.hasOwn(metadata.modules, n))) throw new Error(`Invalid split unit membership: ${g.name}`);
            g.modules.forEach(n => mounted.add(n));
            if (g.unit.size > m.budgets.unitBytes) throw new Error(`SPLIT_SIZE_EXCEEDED: ${g.name}: ${g.unit.size} unit bytes > ${m.budgets.unitBytes} budget bytes`);
            const bytes = artifact.files.find(f => f.path === g.unit.file && f.role !== 'static')?.bytes;
            if (!bytes) continue;
            const code = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
            if (code.split(m.releaseId).length !== 2) throw new Error(`Invalid embedded release: ${g.name}`);
            normalizedUnits.push({ group: g.name, path: g.unit.file, sha256: outputHash(bytes), size: bytes.length, normalizedSha256: outputHash(code.replace(m.releaseId, 'SPLITRELEASE0000')) });
        }
        for (const [name, mod] of Object.entries(metadata.modules) as [string, { clientOnly: boolean }][]) if (!mounted.has(name) && !mod.clientOnly) throw new Error('SPLIT_MODULE_UNMOUNTED');
        const groups = m.groups.map(g => ({ ...g, unit: { ...g.unit, sha256: normalizedUnits.find(u => u.group === g.name)?.normalizedSha256 } }));
        if (normalizedUnits.length === m.groups.length && outputHash(outputCanonical({ groups, shell: m.shell, snapshot: m.snapshot, static: output.static.sha256 })).slice(0, 16) !== m.releaseId) throw new Error('Split release identity mismatch');
        if (output.shell !== undefined) verifyShell(artifact, m, metadata, output.shell);
    } catch (error) { differences.push(`Split output invalid: ${(error as Error).message}`); }
    const actual = artifact.files.filter(f => splitStatic(f) && f.path !== 'composition-provenance.json')
        .map(f => ({ path: f.path, sha256: outputHash(f.bytes), size: f.bytes.length })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const expected = new Map<string, LinkedFile>();
    for (const f of output.static.files) { if (expected.has(f.path)) throw new Error(`Duplicate static file in metadata: ${f.path}`); expected.set(f.path, f); }
    for (const f of output.static.files) {
        const other = actual.find(a => a.path === f.path);
        if (!other) differences.push(`Missing static file: ${f.path}`);
        else if (f.sha256 !== other.sha256 || f.size !== other.size) differences.push(`Static hash mismatch: ${f.path} (expected ${f.sha256}/${f.size}, actual ${other.sha256}/${other.size})`);
    }
    for (const f of actual) if (!expected.has(f.path)) differences.push(`Extra static file: ${f.path}`);
    if (outputDigest(output.static.files) !== output.static.sha256) differences.push('Static inventory digest mismatch in metadata');
    if (outputDigest(actual) !== output.static.sha256) differences.push('Static output digest mismatch');
    if (differences.length) throw new Error('Export verification failed:\n' + differences.join('\n'));
    return { scriptSha256: outputHash(outputCanonical(output.units)), staticSha256: output.static.sha256, metadataSha256, allowUnboundOutput: false, adapted: false,
        split: { releaseId: manifest!.releaseId, units: normalizedUnits, manifestSha256: output.manifest.sha256 } };
}

/** Mirrors the native producer's optional self-pinned export verification. */
function verifyShell(artifact: Artifact, manifest: SplitManifest, metadata: any, expected: LinkedFile[]) {
    const pins = artifact.files.filter(splitPin);
    const record = (f: ArtifactFile) => ({ path: f.path, sha256: outputHash(f.bytes), size: f.bytes.length });
    const inventory = [...pins.filter(f => f.path.startsWith('shell/')).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), ...pins.filter(f => f.path === 'hadars.lock')].map(record);
    if (outputCanonical(inventory) !== outputCanonical(expected)) throw new Error('Shell inventory mismatch');
    const read = (path: string) => { const f = pins.find(f => f.path === path); if (!f) throw new Error(`Missing shell file: ${path}`); return f.bytes; };
    const parse = (path: string) => JSON.parse(new TextDecoder().decode(read(path)));
    const shell: BuildManifest = parse('shell/manifest.json');
    if (shell.kind !== 'shell' || shell.buildId !== manifest.shell || buildIdFor(shell) !== shell.buildId) throw new Error('Shell build identity mismatch');
    const files = pins.filter(f => f.path.startsWith('shell/artifact/'));
    if (files.length !== shell.files.length || new Set(shell.files.map(f => f.path)).size !== shell.files.length) throw new Error('Shell artifact file set mismatch');
    for (const f of shell.files) {
        if (!fileOK(f)) throw new Error(`Invalid export path: ${f.path}`);
        const bytes = read('shell/artifact/' + f.path);
        if (bytes.length !== f.size || outputHash(bytes) !== f.sha256) throw new Error(`Shell artifact hash mismatch: ${f.path}`);
        if (f.path.startsWith('client/')) {
            const shared = artifact.files.find(a => splitStatic(a) && a.path === f.path.slice(7));
            if (!shared || !Buffer.from(bytes).equals(shared.bytes)) throw new Error(`Shell client differs from static output: ${f.path}`);
        }
    }
    const lock = parse('hadars.lock');
    const select = (map: Record<string, string>, kind: string): BuildManifest[] => Object.values(map).map(id => {
        const pin = lock.builds[id].manifest;
        if (pin.kind !== kind || buildIdFor(pin) !== pin.buildId) throw new Error('Shell lock build identity mismatch');
        return pin;
    });
    const modules = select(lock.snapshot.modules, 'module'), libraries = select(lock.snapshot.libraries, 'library');
    const all = [shell, ...modules, ...libraries];
    assertNativeLockCompatibility(shell, modules, libraries);
    if (new Set(all.map(m => m.name)).size !== all.length) throw new Error('Duplicate lock build name');
    const pinMap = (builds: BuildManifest[]) => Object.fromEntries([...builds].sort((a, b) => a.name.localeCompare(b.name)).map(m => [m.name, m.buildId]));
    const identity = { shell: shell.buildId, modules: pinMap(modules), libraries: pinMap(libraries) };
    const snapshot = { ...identity, id: snapshotIdFor(identity) };
    const rebuilt = { version: 1, snapshot, snapshotId: snapshot.id, snapshotSha256: outputHash(outputCanonical(snapshot)), builds: Object.fromEntries(all.map(m => [m.buildId, { manifest: m, sha256: outputHash(outputCanonical(m)) }])) };
    if (outputCanonical(lock) !== outputCanonical(rebuilt) || lock.snapshotId !== manifest.snapshot) throw new Error('Shell lock snapshot mismatch');
    const linkedPins = Object.fromEntries(Object.entries(metadata.modules).map(([name, value]: [string, any]) => [name, value.buildId]));
    if (outputCanonical(linkedPins) !== outputCanonical(lock.snapshot.modules)) throw new Error('Shell lock module pins mismatch');
    for (const [name, linked] of Object.entries(metadata.modules) as [string, any][]) {
        const pin = lock.builds[linkedPins[name]].manifest;
        if (!!pin.clientOnly !== linked.clientOnly) throw new Error(`Shell lock client-only mismatch: ${name}`);
        const serverFiles = pin.files.filter((p: LinkedFile) => p.path.startsWith('server/') || [...pin.targets.server.js, ...pin.targets.server.css].includes(p.path));
        for (const f of linked.server) if (!serverFiles.some((p: LinkedFile) => outputCanonical(p) === outputCanonical(f))) throw new Error(`Shell lock linked server mismatch: ${name}`);
        if (!pin.clientOnly && pin.targets.server.js.some((entry: string) => !linked.server.some((f: LinkedFile) => f.path === entry))) throw new Error(`Shell lock missing server inputs: ${name}`);
    }
}
