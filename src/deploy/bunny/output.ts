import { createHash } from 'node:crypto';
import { verifySplitOutput, type SplitOutput } from './split';
import type { Artifact, LinkedFile } from './index';

export interface SingleExportOutput {
    version: 1;
    entry: LinkedFile;
    static: { directory: string; files: LinkedFile[]; sha256: string };
    metadataSha256: string;
    signature?: unknown;
}
export type ExportOutput = SingleExportOutput | SplitOutput;
export interface OutputVerification {
    split?: { releaseId: string; units: { group: string; path: string; sha256: string; size: number; normalizedSha256: string }[]; manifestSha256: string };
    scriptSha256: string;
    staticSha256: string;
    metadataSha256?: string;
    allowUnboundOutput: boolean;
    adapted: boolean;
    adaptedSha256?: string;
}
export const outputHash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Native composition/identity.ts canonicalization: localeCompare keys, ordered arrays.
export const outputCanonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const outputDigest = (files: LinkedFile[]) => outputHash(JSON.stringify(files.map(f => [f.path, f.sha256, f.size])));
const pathOK = (p: unknown): p is string => typeof p === 'string' && !!p && !p.includes('\\') && !p.includes('\0') && !p.split('/').some(s => !s || s === '.' || s === '..');
const fileOK = (f: LinkedFile) => f && pathOK(f.path) && /^[a-f0-9]{64}$/.test(f.sha256) && Number.isSafeInteger(f.size) && f.size >= 0;

/** Native exportIntegrity.ts v1 algorithm over loaded bytes; never execute the export. */
export function verifyOutput(artifact: Artifact, allowUnboundOutput = false): OutputVerification {
    if (!pathOK(artifact.entry) || new Set(artifact.files.map(f => `${f.role ?? ''}:${f.path}`)).size !== artifact.files.length || artifact.files.some(f => !pathOK(f.path))) throw new Error('Invalid artifact paths');
    if (artifact.files.some(f => f.role !== undefined && !['unit', 'static', 'manifest', 'pin'].includes(f.role) || f.role === 'manifest' && f.path !== '.hadars/split-manifest.json' || f.role === 'unit' && !f.path.startsWith('units/') || f.role === 'pin' && !(f.path.startsWith('shell/') || f.path === 'hadars.lock'))) throw new Error('Invalid artifact file role');
    if (artifact.files.some(f => f.role === 'manifest' || f.role === undefined && f.path === '.hadars/split-manifest.json' && artifact.entry.startsWith('units/'))) return verifySplitOutput(artifact);
    const script = artifact.files.find(f => f.path === artifact.entry);
    if (!script) throw new Error(`Missing entry script: ${artifact.entry}`);
    const actual = artifact.files.filter(f => f.path !== artifact.entry && f.path !== 'composition-provenance.json')
        .map(f => ({ path: f.path, sha256: outputHash(f.bytes), size: f.bytes.length }))
        .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const record: OutputVerification = { scriptSha256: outputHash(script.bytes), staticSha256: outputDigest(actual), allowUnboundOutput: false, adapted: false };
    const metadataFile = artifact.files.find(f => f.path === 'composition-provenance.json');
    let metadata;
    try { metadata = metadataFile ? JSON.parse(new TextDecoder().decode(metadataFile.bytes)) : undefined; }
    catch { throw new Error('Export metadata unreadable: composition-provenance.json'); }
    const output = metadata?.output as ExportOutput | undefined;
    if (output?.version === 2) throw new Error('Split export requires .hadars/split-manifest.json');
    if (!output || output.version !== 1) {
        if (!allowUnboundOutput) throw new Error('Export metadata missing or unsupported output version; re-export with finalizeExport, or explicitly use --allow-unbound-output (UNVERIFIED OUTPUT)');
        return { ...record, allowUnboundOutput: true };
    }
    const { metadataSha256, signature, ...rest } = output;
    const digest = outputHash(outputCanonical({ ...metadata, output: rest }));
    if (digest !== metadataSha256) throw new Error(`Export metadata checksum mismatch (expected ${metadataSha256}, actual ${digest})`);
    if (!fileOK(output.entry) || !output.static || !Array.isArray(output.static.files) || !output.static.files.every(fileOK)) throw new Error('Invalid export output records');
    // The artifact loader's fixed layout must match the paths the native verifier reads.
    if (output.entry.path !== artifact.entry || output.static.directory !== '.hadars/static') throw new Error(`Export output layout mismatch: expected ${artifact.entry} and .hadars/static, got ${output.entry.path} and ${output.static.directory}`);
    const differences: string[] = [];
    if (record.scriptSha256 !== output.entry.sha256 || script.bytes.length !== output.entry.size) differences.push(`Entry script changed: ${output.entry.path} (expected ${output.entry.sha256}/${output.entry.size}, actual ${record.scriptSha256}/${script.bytes.length})`);
    const expected = new Map<string, LinkedFile>();
    for (const file of output.static.files) {
        if (expected.has(file.path)) throw new Error(`Duplicate static file in metadata: ${file.path}`);
        expected.set(file.path, file);
    }
    const found = new Map(actual.map(f => [f.path, f]));
    for (const [p, file] of expected) {
        const other = found.get(p);
        if (!other) differences.push(`Missing static file: ${p}`);
        else if (file.sha256 !== other.sha256 || file.size !== other.size) differences.push(`Static hash mismatch: ${p} (expected ${file.sha256}/${file.size}, actual ${other.sha256}/${other.size})`);
    }
    for (const p of found.keys()) if (!expected.has(p)) differences.push(`Extra static file: ${p}`);
    if (outputDigest(output.static.files) !== output.static.sha256) differences.push('Static inventory digest mismatch in metadata');
    if (record.staticSha256 !== output.static.sha256) differences.push('Static output digest mismatch');
    if (differences.length) throw new Error('Export verification failed:\n' + differences.join('\n'));
    return { ...record, metadataSha256 };
}
