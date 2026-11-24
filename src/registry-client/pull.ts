import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { openBlob, SEAL_OVERHEAD, sriFromHex, type BuildManifest, type Snapshot, type Channel } from '../registry-protocol';
import { ApiError, type Client } from './client';
import { bytesHash, canonicalJson, makeLock, readLock, registryOrigin, verifyLockSignature, type Lockfile, type TrustedKeys } from './lockfile';

export interface PullOptions { client: Client; registry: string; team: string; channel: string; project: string;
    /** When given, the channel move must carry a valid signature from one of these keys, or nothing is installed. */
    trustedKeys?: TrustedKeys }
export interface Resolution { channel: Channel; snapshot: Snapshot; builds: BuildManifest[] }
const route = (team: string, channel: string) => `/v1/teams/${encodeURIComponent(team)}/channels/${encodeURIComponent(channel)}`;
async function noSymlink(file: string) {
    try { if ((await lstat(file)).isSymbolicLink()) throw new ApiError('unsafe_path', `Refusing to replace symlink ${file}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}
async function exists(file: string) { try { await lstat(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
async function download(url: string, expected: number, registry: string) {
    const u = new URL(url);
    if (u.username || u.password || (u.protocol !== 'https:' && u.origin !== registryOrigin(registry))) throw new ApiError('unsafe_url', 'Download URL must use HTTPS (registry loopback is allowed locally).');
    let r: Response;
    try { r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
    catch { throw new ApiError('download_failed', 'Artifact download failed or timed out (signed URL omitted).'); }
    if (!r.ok || !r.body) throw new ApiError('download_failed', `Artifact download returned HTTP ${r.status}`);
    const parts: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of r.body) {
        size += chunk.length;
        if (size > expected) throw new ApiError('checksum', 'Downloaded artifact exceeds its declared size');
        parts.push(chunk);
    }
    if (size !== expected) throw new ApiError('checksum', 'Downloaded artifact has the wrong size');
    return Buffer.concat(parts);
}
/** Verified artifacts first, then atomically replace the generated types, config and lock. */
export async function pull(o: PullOptions) {
    const dir = join(resolve(o.project), '.hadars');
    await noSymlink(dir); await mkdir(dir, { recursive: true });
    const guard = join(dir, '.pull-lock');
    try { await mkdir(guard); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new ApiError('busy', 'Another pull is running; remove .hadars/.pull-lock only if the earlier process exited.'); throw e; }
    try { return await pullUnlocked(o); } finally { await rm(guard, { recursive: true, force: true }); }
}
async function pullUnlocked(o: PullOptions) {
    const resolved = await o.client.request<Resolution>('GET', route(o.team, o.channel));
    if (resolved.channel.name !== o.channel || resolved.channel.snapshotId !== resolved.snapshot.id) throw new ApiError('invalid', 'Channel response does not match the requested snapshot');
    const lock = makeLock(o.registry, o.team, o.channel, resolved.snapshot, resolved.builds, resolved.channel);
    if (o.trustedKeys) verifyLockSignature(lock, o.trustedKeys);
    const root = resolve(o.project), generated = join(root, '.hadars');
    await noSymlink(join(root, 'hadars.lock')); await noSymlink(generated);
    await mkdir(generated, { recursive: true });
    const staging = await mkdtemp(join(generated, '.pull-'));
    let downloaded = 0;
    try {
        const paths: Record<string, string[]> = {};
        const typeFiles: string[] = [];
        const integrity: Record<string, string> = {};
        let blobKey: Uint8Array | undefined;
        for (const { manifest: build } of Object.values(lock.builds)) {
            const downloads = await o.client.request<Array<{ path: string; sha256: string; size: number; url: string; encryption: { address: string } }>>('GET', `/v1/teams/${encodeURIComponent(o.team)}/builds/${build.buildId}/downloads`);
            if (!Array.isArray(downloads) || downloads.length !== build.files.length || new Set(downloads.map((f) => f.path)).size !== downloads.length) throw new ApiError('invalid', 'Download manifest does not match build');
            for (const f of build.files) {
                const descriptor = downloads.find((d) => d.path === f.path);
                if (!descriptor || descriptor.sha256 !== f.sha256 || descriptor.size !== f.size) throw new ApiError('invalid', `Download metadata mismatch for ${build.name}/${f.path}`);
                // Recheck cached bytes; a corrupt cache can never bypass verification.
                const cached = join(generated, 'builds', build.buildId, f.path);
                let bytes: Buffer | undefined;
                try { const b = await readFile(cached); if (b.length === f.size && bytesHash(b) === f.sha256) bytes = b; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
                if (!bytes) {
                    const enc = descriptor.encryption;
                    if (!enc || !/^[a-f0-9]{64}$/.test(enc.address)) throw new ApiError('invalid', `Missing or invalid blob address for ${build.name}/${f.path}`);
                    const raw = await download(descriptor.url, f.size + SEAL_OVERHEAD, o.registry); downloaded++;
                    if (!blobKey) {
                        const granted = await o.client.request<{ key: string }>('GET', `/v1/teams/${encodeURIComponent(o.team)}/key`);
                        if (!granted?.key) throw new ApiError('no_key', 'The registry returned no decryption key.');
                        blobKey = Buffer.from(granted.key, 'base64');
                    }
                    try { bytes = Buffer.from(openBlob(blobKey, o.team, enc.address, raw)); }
                    catch { throw new ApiError('decrypt', `Could not decrypt ${build.name}/${f.path}: wrong key or tampered data`); }
                }
                if (bytesHash(bytes) !== f.sha256) throw new ApiError('checksum', `sha256 mismatch for ${build.name}/${f.path}`);
                integrity[`${build.buildId}/${f.path}`] = sriFromHex(f.sha256);
                const dest = join(staging, 'builds', build.buildId, f.path);
                await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, bytes);
                if (build.types?.includes(f.path)) {
                    if (!f.path.startsWith('types/')) throw new ApiError('invalid', 'Declaration files must live under types/');
                    const typeFile = join(staging, 'types', build.name, f.path.slice(6));
                    await mkdir(dirname(typeFile), { recursive: true }); await writeFile(typeFile, bytes);
                    typeFiles.push(`./types/${build.name}/${f.path.slice(6)}`);
                }
            }
            for (const ns of build.exposes) {
                const entry = [`types/${ns}.d.ts`, `types/${ns}/index.d.ts`].find((p) => build.types?.includes(p));
                if (entry) paths[`${build.name}/${ns}`] = [`./types/${build.name}/${entry.slice(6)}`];
                else if (build.types?.length) throw new ApiError('missing_types', `${build.name}/${ns} has no types/${ns}.d.ts declaration entry`);
            }
            if (build.types?.includes('types/index.d.ts')) paths[build.name] = [`./types/${build.name}/index.d.ts`];
        }
        await mkdir(join(staging, 'types'), { recursive: true });
        await writeFile(join(staging, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths }, files: typeFiles.sort() }, null, 2) + '\n');
        await writeFile(join(staging, 'integrity.json'), JSON.stringify(integrity, null, 2) + '\n');
        await writeFile(join(staging, 'hadars.lock'), canonicalJson(lock) + '\n');
        // Only these generated paths are replaced. Roll back if any rename fails; lock is last.
        await noSymlink(join(generated, 'builds')); await mkdir(join(generated, 'builds'), { recursive: true });
        // Keep verified older builds for pinned readers; garbage collection is a separate operation.
        const targets = [...Object.keys(lock.builds).map((id) => `builds/${id}`), 'types', 'tsconfig.json', 'integrity.json', 'hadars.lock'];
        const moved: Array<{ dest: string; backup: string; hadOld: boolean }> = [];
        try {
            for (const target of targets) {
                const dest = target === 'hadars.lock' ? join(root, target) : join(generated, target);
                await noSymlink(dest);
                const backup = join(staging, `old-${target.replaceAll('/', '-')}`);
                const hadOld = await exists(dest);
                if (hadOld) await rename(dest, backup);
                moved.push({ dest, backup, hadOld });
                await rename(join(staging, target), dest);
            }
        } catch (e) {
            for (const m of moved.reverse()) { await rm(m.dest, { recursive: true, force: true }); if (m.hadOld) await rename(m.backup, m.dest); }
            throw e;
        }
        return { lock, downloaded };
    } finally { await rm(staging, { recursive: true, force: true }); }
}
export async function outdated(o: { client: Client; project: string; registry: string; team: string }) {
    const lock = await readLock(o.project);
    if (!lock) throw new ApiError('missing_lock', 'Run pull first to create hadars.lock.');
    if (lock.registry !== registryOrigin(o.registry) || lock.team !== o.team) throw new ApiError('invalid_lock', 'Lock belongs to another registry or team.');
    const latest = await o.client.request<Resolution>('GET', route(o.team, lock.channel));
    if (latest.channel.name !== lock.channel || latest.channel.snapshotId !== latest.snapshot.id) throw new ApiError('invalid', 'Channel response does not match the requested snapshot');
    const next = makeLock(o.registry, o.team, lock.channel, latest.snapshot, latest.builds, latest.channel);
    const byName = (l: Lockfile) => Object.fromEntries(Object.values(l.builds).map((b) => [`${b.manifest.kind}:${b.manifest.name}`, b.manifest.buildId]));
    const current = byName(lock), available = byName(next);
    const changes = [...new Set([...Object.keys(current), ...Object.keys(available)])].sort().filter((n) => current[n] !== available[n]).map((name) => ({ name, current: current[name] ?? null, available: available[name] ?? null }));
    return { outdated: lock.snapshotId !== next.snapshotId, currentSnapshot: lock.snapshotId, availableSnapshot: next.snapshotId, changes };
}
