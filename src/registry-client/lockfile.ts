import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeBuildManifest, TEAM_ID, channelMoveStatement, verifyStatement, type ChannelSignature, snapshotIdFor, validateBuild, validateSnapshot, type BuildManifest, type Snapshot } from '../registry-protocol';
import { ApiError } from './client';

export interface Lockfile {
    version: 1;
    registry: string; team: string; channel: string;
    snapshotId: string; snapshotSha256: string; snapshot: Snapshot;
    /** Each manifest pins kind/name/build ID and every file's sha256 and size. No signed URLs or credentials. */
    builds: Record<string, { sha256: string; manifest: BuildManifest }>;
    /** The channel version the snapshot was pulled at and the signature over that move, when the registry had one. */
    channelVersion?: number;
    signature?: ChannelSignature;
}

/** Public keys the runtime trusts, by key ID. They live with the runtime, never in the registry. */
export type TrustedKeys = Record<string, string>;
export async function readTrustedKeys(file: string): Promise<TrustedKeys> {
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(file, 'utf8')); } catch { throw new ApiError('invalid_keys', `Cannot read trusted keys from ${file} (expected {"<keyId>": "<publicKey>"}).`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.values(parsed).every((v) => typeof v === 'string')) throw new ApiError('invalid_keys', 'Trusted keys must be {"<keyId>": "<publicKey>"}.');
    return parsed as TrustedKeys;
}
/** Checks that a trusted key vouched for exactly this team, channel, version and snapshot. */
export function verifyLockSignature(lock: Lockfile, trusted: TrustedKeys): string {
    if (!lock.signature || lock.channelVersion === undefined) throw new ApiError('unsigned', `${lock.channel} at ${lock.snapshotId} carries no signature.`);
    const key = trusted[lock.signature.keyId];
    if (!key) throw new ApiError('untrusted_key', `Signed by ${lock.signature.keyId}, which is not in the trusted keys.`);
    if (!verifyStatement(key, channelMoveStatement(lock.team, lock.channel, lock.channelVersion, lock.snapshotId), lock.signature.signature)) {
        throw new ApiError('bad_signature', `The signature on ${lock.channel} does not match its team, channel, version and snapshot.`);
    }
    return lock.signature.keyId;
}
export const canonicalJson = (value: any): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const checksum = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const bytesHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function registryOrigin(value: string) {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname)))) throw new ApiError('invalid', 'Registry must be an HTTPS origin (IP loopback HTTP is allowed locally).');
    return u.origin;
}
export function makeLock(registry: string, team: string, channel: string, snapshot: Snapshot, builds: BuildManifest[], moved?: { version: number; signature?: ChannelSignature }): Lockfile {
    const lock: Lockfile = { version: 1, registry: registryOrigin(registry), team, channel,
        snapshotId: snapshot.id, snapshotSha256: checksum(snapshot), snapshot,
        builds: Object.fromEntries(builds.map(nativeBuildManifest).map((manifest) => [manifest.buildId, { sha256: checksum(manifest), manifest }])),
        ...(moved?.signature ? { channelVersion: moved.version, signature: { keyId: moved.signature.keyId, signature: moved.signature.signature } } : {}) };
    validateLock(lock);
    return lock;
}
export function validateLock(input: unknown): asserts input is Lockfile {
    const fail = (detail: string): never => { throw new ApiError('invalid_lock', `Invalid hadars.lock: ${detail}`); };
    const l = input as Lockfile;
    if (!l || l.version !== 1 || typeof l.registry !== 'string' || typeof l.team !== 'string' || !TEAM_ID.test(l.team) || typeof l.channel !== 'string' || !l.channel || !l.builds || typeof l.builds !== 'object' || Array.isArray(l.builds)) fail('format or binding');
    try { if (registryOrigin(l.registry) !== l.registry) fail('registry origin'); } catch { fail('registry origin'); }
    if (l.signature !== undefined && (typeof l.signature?.keyId !== 'string' || typeof l.signature?.signature !== 'string' || !Number.isSafeInteger(l.channelVersion))) fail('signature');
    const s = l.snapshot;
    const map = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');
    if (!s || typeof s.shell !== 'string' || !map(s.modules) || !map(s.libraries) || s.id !== l.snapshotId || snapshotIdFor(s) !== s.id || checksum(s) !== l.snapshotSha256) fail('snapshot identity/checksum');
    const ids = new Set([s.shell, ...Object.values(s.modules), ...Object.values(s.libraries)]);
    if (ids.size !== Object.keys(l.builds).length) fail('unexpected or missing builds');
    const manifests: Record<string, BuildManifest> = {};
    for (const id of ids) {
        const b = l.builds[id];
        if (!b || b.manifest?.buildId !== id || validateBuild(b.manifest).length || checksum(b.manifest) !== b.sha256) fail(`build ${id} identity/checksum`);
        manifests[id] = b.manifest;
    }
    if (manifests[s.shell].kind !== 'shell') fail('shell kind');
    for (const [name, id] of Object.entries(s.modules)) if (manifests[id].name !== name || manifests[id].kind !== 'module') fail(`module ${name}`);
    for (const [name, id] of Object.entries(s.libraries)) if (manifests[id].name !== name || manifests[id].kind !== 'library') fail(`library ${name}`);
    if (validateSnapshot(s, manifests).length) fail('snapshot compatibility');
}
export async function readLock(project: string): Promise<Lockfile | null> {
    let text: string;
    try { text = await readFile(join(project, 'hadars.lock'), 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new ApiError('invalid_lock', 'hadars.lock is not valid JSON'); }
    validateLock(value);
    return value;
}
