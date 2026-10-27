import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readBuildFiles } from './artifacts';
import { canonical, hash } from './identity';
import { splitBudget, validateRoutes, type SplitManifest } from './split';

export interface ExportFile {
    path: string;
    sha256: string;
    size: number;
}

export interface SingleExportOutput {
    version: 1;
    entry: ExportFile;
    static: { directory: string; files: ExportFile[]; sha256: string };
    metadataSha256: string;
    /** Reserved for a future detached signature; no signing or signature verification yet. */
    signature?: unknown;
}

export interface SplitExportOutput {
    version: 2;
    units: ExportFile[];
    manifest: ExportFile;
    static: SingleExportOutput['static'];
    metadataSha256: string;
    signature?: unknown;
}
export type ExportOutput = SingleExportOutput | SplitExportOutput;
export const RELEASE_PLACEHOLDER = 'SPLITRELEASE0000';
export function staticDigest(staticDir: string): string {
    return digest(inventory(staticDir, path.join(staticDir, 'composition-provenance.json')));
}
/** Release identity uses placeholder hashes; the public manifest always hashes final bytes. */
export function splitReleaseId(manifest: SplitManifest, groups: SplitManifest['groups'], staticHash: string): string {
    return hash(canonical({ groups, shell: manifest.shell, snapshot: manifest.snapshot, static: staticHash })).slice(0, 16);
}
/** Complete placeholder bundles using the same byte identity and seal pipeline for every exporter. */
export function completeSplitExport(directory: string, manifest: SplitManifest, staticDir: string, linkedSizes: Record<string, number> = {}): SplitExportOutput {
    validateRoutes(manifest);
    const budget = splitBudget(manifest.budgets);
    for (const group of manifest.groups) {
        const bytes = readEntry(directory, group.unit.file);
        if (bytes.toString('utf8').split(RELEASE_PLACEHOLDER).length !== 2) throw new Error(`SPLIT_RELEASE_PLACEHOLDER: ${group.name}`);
        group.unit.sha256 = hash(bytes);
        group.unit.size = bytes.length;
        const linked = linkedSizes[group.name] ?? 0;
        console.log(`Unit "${group.name}": ${bytes.length} bytes; ${linked} linked module bytes`);
        if (bytes.length > budget) {
            const error = new Error(`SPLIT_SIZE_EXCEEDED: ${group.name}: ${bytes.length} unit bytes, ${linked} linked module bytes > ${budget} budget bytes`);
            error.name = 'SplitSizeExceededError';
            throw error;
        }
    }
    manifest.releaseId = splitReleaseId(manifest, manifest.groups, staticDigest(staticDir));
    for (const group of manifest.groups) {
        const bytes = Buffer.from(readEntry(directory, group.unit.file).toString('utf8').replace(RELEASE_PLACEHOLDER, manifest.releaseId));
        writeFileSync(inside(directory, group.unit.file), bytes);
        group.unit.sha256 = hash(bytes);
    }
    return finalizeSplitExport(directory, manifest, staticDir);
}
export function finalizeSplitExport(directory: string, manifest: SplitManifest, staticDir: string): SplitExportOutput {
    validateRoutes(manifest);
    splitBudget(manifest.budgets);
    const manifestPath = '.hadars/split-manifest.json';
    writeFileSync(inside(directory, manifestPath), JSON.stringify(manifest, null, 2) + '\n');
    const bytes = readEntry(directory, manifestPath);
    const metadataFile = path.join(staticDir, 'composition-provenance.json');
    const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
    const files = inventory(staticDir, metadataFile);
    const output: SplitExportOutput = {
        version: 2,
        units: manifest.groups.map(g => ({ path: g.unit.file, sha256: g.unit.sha256, size: g.unit.size })),
        manifest: { path: manifestPath, sha256: hash(bytes), size: bytes.length },
        static: { directory: relative(directory, staticDir), files, sha256: digest(files) },
        metadataSha256: '',
    };
    metadata.output = output;
    output.metadataSha256 = metadataDigest(metadata);
    writeFileSync(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
    return output;
}

function relative(directory: string, file: string): string {
    const result = path.relative(path.resolve(directory), path.resolve(file)).split(path.sep).join('/');
    if (!result || result.startsWith('../') || path.isAbsolute(result)) throw new Error(`Export path is outside directory: ${file}`);
    return result;
}

function inside(directory: string, file: string): string {
    if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0') || file.split('/').some(p => !p || p === '.' || p === '..') || path.isAbsolute(file)) {
        throw new Error(`Invalid export path: ${file}`);
    }
    return path.resolve(directory, file);
}

const digest = (files: ExportFile[]) => hash(JSON.stringify(files.map(f => [f.path, f.sha256, f.size])));
function inventory(staticDir: string, metadataFile: string): ExportFile[] {
    return [...readBuildFiles(staticDir)].filter(([p]) => path.resolve(staticDir, p) !== path.resolve(metadataFile))
        .map(([p, bytes]) => ({ path: p, sha256: hash(bytes), size: bytes.length }))
        .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function metadataDigest(metadata: any): string {
    const { metadataSha256, signature, ...output } = metadata.output;
    return hash(canonical({ ...metadata, output }));
}

/** Seal completed output in the existing provenance file. All paths are relative to directory. */
export function finalizeExport(directory: string, entryFile: string, staticDir: string): SingleExportOutput {
    const metadataFile = path.join(staticDir, 'composition-provenance.json');
    const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
    // Reject symbolic links and special files in the entry's directory chain too.
    const entryPath = relative(directory, entryFile);
    const entryBytes = readEntry(directory, entryPath);
    const files = inventory(staticDir, metadataFile);
    const output: SingleExportOutput = {
        version: 1,
        entry: { path: entryPath, sha256: hash(entryBytes), size: entryBytes.length },
        static: { directory: relative(directory, staticDir), files, sha256: digest(files) },
        metadataSha256: '',
    };
    metadata.output = output;
    output.metadataSha256 = metadataDigest(metadata);
    writeFileSync(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
    return output;
}

function readEntry(directory: string, entry: string): Buffer {
    // Inspect only the entry path, without reading unrelated output siblings.
    let current = path.resolve(directory);
    for (const part of entry.split('/')) {
        current = path.join(current, part);
        const st = lstatSync(current);
        if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) throw new Error(`Unsafe entry script: ${entry}`);
    }
    return readFileSync(current);
}

/** Verify completed output, optionally against a checksum retained by a trusted deployment tool. */
export function verifyExport(directory: string, metadataPath: string, expectedMetadataSha256?: string): ExportOutput {
    const metadataFile = inside(directory, metadataPath);
    let metadata: any;
    try { metadata = JSON.parse(readEntry(directory, metadataPath).toString('utf8')); }
    catch (error: any) { throw new Error(`Export metadata unreadable: ${metadataPath}: ${error.message}`); }
    const output = metadata.output as ExportOutput;
    if (!output || ![1, 2].includes(output.version)) throw new Error('Export metadata missing or unsupported output version');
    if (metadataDigest(metadata) !== output.metadataSha256 || (expectedMetadataSha256 && expectedMetadataSha256 !== output.metadataSha256)) {
        throw new Error('Export metadata checksum mismatch');
    }
    const staticDir = inside(directory, output.static.directory);
    const differences: string[] = [];
    const entries = output.version === 1 ? [output.entry] : [...output.units, output.manifest];
    const seen = new Set<string>();
    for (const entry of entries) {
        inside(directory, entry.path);
        if (seen.has(entry.path)) throw new Error(`Duplicate output file: ${entry.path}`);
        seen.add(entry.path);
        try {
            const bytes = readEntry(directory, entry.path);
            if (hash(bytes) !== entry.sha256 || bytes.length !== entry.size) differences.push(`Entry script changed: ${entry.path} (expected ${entry.sha256}/${entry.size}, actual ${hash(bytes)}/${bytes.length})`);
        } catch (error: any) {
            differences.push(error.code === 'ENOENT' ? `Missing entry script: ${entry.path}` : error.message);
        }
    }
    if (output.version === 2) {
        try {
            const actualUnits = readBuildFiles(inside(directory, 'units'));
            const expectedUnits = new Set(output.units.map(u => u.path));
            for (const p of actualUnits.keys()) if (!expectedUnits.has('units/' + p)) differences.push(`Extra unit: units/${p}`);
            const manifest: SplitManifest = JSON.parse(readEntry(directory, output.manifest.path).toString('utf8'));
            validateRoutes(manifest);
            const budget = splitBudget(manifest.budgets);
            if (manifest.version !== 1 || manifest.mode !== 'per-module' || manifest.probe?.path !== '/__hadars/release' || !/^[a-f0-9]{16}$/.test(manifest.releaseId)) throw new Error('Invalid split manifest');
            if (manifest.shell !== metadata.shell || manifest.snapshot !== metadata.snapshot) throw new Error('Split manifest composition identity mismatch');
            const units = manifest.groups.map(g => ({ path: g.unit.file, sha256: g.unit.sha256, size: g.unit.size }));
            if (canonical(units) !== canonical(output.units)) throw new Error('Split manifest units differ from seal');
            const normalized = manifest.groups.map(g => {
                if (g.unit.file !== `units/${g.name}/bunny.mjs` || canonical(g.modules) !== canonical(g.name === manifest.defaultGroup ? [] : [g.name])) throw new Error(`Invalid split unit membership: ${g.name}`);
                if (!Number.isSafeInteger(g.unit.size) || g.unit.size < 0 || g.unit.size > budget) throw new Error(`SPLIT_SIZE_EXCEEDED: ${g.name}: ${g.unit.size} unit bytes > ${budget} budget bytes`);
                const text = readEntry(directory, g.unit.file).toString('utf8');
                if (text.split(manifest.releaseId).length !== 2) throw new Error(`Invalid embedded release: ${g.name}`);
                return { ...g, unit: { ...g.unit, sha256: hash(text.replace(manifest.releaseId, RELEASE_PLACEHOLDER)) } };
            });
            if (splitReleaseId(manifest, normalized, output.static.sha256) !== manifest.releaseId) throw new Error('Split release identity mismatch');
        } catch (error: any) { differences.push(`Split output invalid: ${error.message}`); }
    }
    const expected = new Map<string, ExportFile>();
    for (const file of output.static.files) {
        inside(staticDir, file.path);
        if (expected.has(file.path)) throw new Error(`Duplicate static file in metadata: ${file.path}`);
        expected.set(file.path, file);
    }
    let actual: ExportFile[] = [];
    try { actual = inventory(staticDir, metadataFile); }
    catch (error: any) { differences.push(`Static output unreadable: ${error.message}`); }
    const found = new Map(actual.map(file => [file.path, file]));
    for (const [p, file] of expected) {
        const other = found.get(p);
        if (!other) differences.push(`Missing static file: ${p}`);
        else if (file.sha256 !== other.sha256 || file.size !== other.size) differences.push(`Static hash mismatch: ${p} (expected ${file.sha256}/${file.size}, actual ${other.sha256}/${other.size})`);
    }
    for (const p of found.keys()) if (!expected.has(p)) differences.push(`Extra static file: ${p}`);
    if (digest(output.static.files) !== output.static.sha256) differences.push('Static inventory digest mismatch in metadata');
    if (digest(actual) !== output.static.sha256) differences.push('Static output digest mismatch');
    if (differences.length) throw new Error('Export verification failed:\n' + differences.join('\n'));
    return output;
}
