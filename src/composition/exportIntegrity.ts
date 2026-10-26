import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readBuildFiles } from './artifacts';
import { canonical, hash } from './identity';

export interface ExportFile {
    path: string;
    sha256: string;
    size: number;
}

export interface ExportOutput {
    version: 1;
    entry: ExportFile;
    static: { directory: string; files: ExportFile[]; sha256: string };
    metadataSha256: string;
    /** Reserved for a future detached signature; no signing or signature verification yet. */
    signature?: unknown;
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
export function finalizeExport(directory: string, entryFile: string, staticDir: string): ExportOutput {
    const metadataFile = path.join(staticDir, 'composition-provenance.json');
    const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
    // Reject symbolic links and special files in the entry's directory chain too.
    const entryPath = relative(directory, entryFile);
    const entryBytes = readEntry(directory, entryPath);
    const files = inventory(staticDir, metadataFile);
    const output: ExportOutput = {
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
    if (!output || output.version !== 1) throw new Error('Export metadata missing or unsupported output version');
    if (metadataDigest(metadata) !== output.metadataSha256 || (expectedMetadataSha256 && expectedMetadataSha256 !== output.metadataSha256)) {
        throw new Error('Export metadata checksum mismatch');
    }
    inside(directory, output.entry.path);
    const staticDir = inside(directory, output.static.directory);
    const differences: string[] = [];
    try {
        const bytes = readEntry(directory, output.entry.path);
        if (hash(bytes) !== output.entry.sha256 || bytes.length !== output.entry.size) differences.push(`Entry script changed: ${output.entry.path} (expected ${output.entry.sha256}/${output.entry.size}, actual ${hash(bytes)}/${bytes.length})`);
    } catch (error: any) {
        differences.push(error.code === 'ENOENT' ? `Missing entry script: ${output.entry.path}` : error.message);
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
