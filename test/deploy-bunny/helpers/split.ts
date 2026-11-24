import { loadArtifact } from '../../../src/deploy/bunny/artifact';
import { type BuildManifest } from '../../../src/deploy/bunny/identity';
import { outputHash } from '../../../src/deploy/bunny/output';
import { BunnyTarget, summarizeConfig, type RuntimeConfig } from '../../../src/deploy/bunny';
import { mockProvider } from './mockProvider';
export const splitRoot = import.meta.dir + '/../fixtures/split-export';
export async function splitFixture() {
    const artifact = await loadArtifact(splitRoot);
    const lock = await Bun.file(splitRoot + '/hadars.lock').json();
    const builds = Object.values(lock.builds).map((b: any) => b.manifest) as BuildManifest[];
    return { artifact, builds, snapshot: lock.snapshot };
}
export async function splitProvider(propagationSteps = 0) {
    const mock = mockProvider({ split: true, propagationSteps });
    const fixture = await splitFixture();
    const initial = await mock.client.request('POST', '/compute/script', { Name: 'placeholder' });
    await mock.client.publish(String(initial.Id), new TextDecoder().decode(fixture.artifact.files.find(f => f.path === fixture.artifact.entry)!.bytes));
    const zone = await mock.client.request('POST', '/pullzone', { Name: 'demo-dev', EdgeScriptId: initial.Id, OriginType: 4, EnableSmartCache: true, IgnoreQueryStrings: false, DisableCookies: false, AddHostHeader: true });
    const target = new BunnyTarget({ key: 'mock', publicZoneId: String(zone.Id), storageZone: 'assets', storageKey: 'mock' }, mock.send, mock.client, async () => { mock.advance(); });
    const config: RuntimeConfig = { variables: { URL: 'https://local.invalid' }, secrets: { TOKEN: 'mock-secret' }, required: ['URL', 'TOKEN'] };
    const plan = (revision = 1, runtime = config) => target.plan({ project: 'demo', environment: 'dev', revision, artifact: fixture.artifact }, runtime);
    return { mock, target, zone, fixture, config, plan, summary: summarizeConfig(config) };
}

/** Test-only resealer for additional releases/mutations; the literal producer
 * fixture and expected.json are never regenerated or written by these tests. */
export function resealSplit(input: import('../../../src/deploy/bunny').Artifact, mutate?: (manifest: any, metadata: any, artifact: import('../../src').Artifact) => void) {
    const artifact = structuredClone(input), decoder = new TextDecoder();
    const manifestFile = artifact.files.find(f => f.path === '.hadars/split-manifest.json')!, metadataFile = artifact.files.find(f => f.path === 'composition-provenance.json')!;
    const m = JSON.parse(decoder.decode(manifestFile.bytes)), metadata = JSON.parse(decoder.decode(metadataFile.bytes));
    const old = m.releaseId;
    mutate?.(m, metadata, artifact);
    for (const g of m.groups) {
        const file = artifact.files.find(f => f.path === g.unit.file)!;
        file.bytes = Buffer.from(decoder.decode(file.bytes).replace(old, 'SPLITRELEASE0000'));
        g.unit = { ...g.unit, sha256: outputHash(file.bytes), size: file.bytes.length };
    }
    m.releaseId = outputHash(canonical({ groups: m.groups, shell: m.shell, snapshot: m.snapshot, static: metadata.output.static.sha256 })).slice(0, 16);
    for (const g of m.groups) {
        const file = artifact.files.find(f => f.path === g.unit.file)!;
        file.bytes = Buffer.from(decoder.decode(file.bytes).replace('SPLITRELEASE0000', m.releaseId));
        g.unit.sha256 = outputHash(file.bytes);
    }
    manifestFile.bytes = Buffer.from(JSON.stringify(m, null, 2) + '\n');
    metadata.output.units = m.groups.map((g: any) => ({ path: g.unit.file, sha256: g.unit.sha256, size: g.unit.size }));
    metadata.output.manifest = { path: manifestFile.path, sha256: outputHash(manifestFile.bytes), size: manifestFile.bytes.length };
    delete metadata.output.metadataSha256; delete metadata.output.signature;
    metadata.output.metadataSha256 = outputHash(canonical(metadata));
    metadataFile.bytes = Buffer.from(JSON.stringify(metadata, null, 2) + '\n');
    return artifact;
}
import { outputCanonical as canonical } from '../../../src/deploy/bunny/output';
