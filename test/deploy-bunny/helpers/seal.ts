import type { Artifact } from '../../../src/deploy/bunny';
import { outputCanonical, outputDigest, outputHash } from '../../../src/deploy/bunny/output';
/** Test producer only. Production must consume original native metadata. */
export function sealFixture(artifact: Artifact, metadata: Record<string, unknown>) {
    artifact.files = artifact.files.filter(f => f.path !== 'composition-provenance.json');
    const entry = artifact.files.find(f => f.path === artifact.entry)!;
    const file = (f: typeof entry) => ({ path: f.path, sha256: outputHash(f.bytes), size: f.bytes.length });
    const files = artifact.files.filter(f => f !== entry).map(file).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const unsigned = { ...metadata, output: { version: 1, entry: file(entry), static: { directory: '.hadars/static', files, sha256: outputDigest(files) } } };
    const sealed = { ...unsigned, output: { ...unsigned.output, metadataSha256: outputHash(outputCanonical(unsigned)) } };
    artifact.files.push({ path: 'composition-provenance.json', bytes: Buffer.from(JSON.stringify(sealed)) });
    return sealed;
}
