import { test, expect, beforeEach, afterEach } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIdFor, channelMoveStatement, generateSigningKey, sealBlob, signStatement, snapshotIdFor, type BuildManifest } from '../../src/registry-protocol';
import { createClient } from '../../src/registry-client/client';
import { pull } from '../../src/registry-client/pull';

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const enc = (s: string) => new TextEncoder().encode(s);

function build(kind: 'shell' | 'module', name: string, files: Record<string, string>): { manifest: BuildManifest; bytes: Record<string, Uint8Array> } {
    const bytes = Object.fromEntries(Object.entries(files).map(([p, c]) => [p, enc(c)]));
    const body = { kind, name, runtimeContract: '2', flavour: 'production' as const, exposes: kind === 'module' ? [name] : [], shared: [], provides: {}, requires: {},
        targets: { client: { js: [`client/${name}.js`], css: [] }, server: { js: [`server/${name}.cjs`], css: [] } },
        files: Object.entries(bytes).map(([path, b]) => ({ path, size: b.length, sha256: sha(b) })) } as Omit<BuildManifest, 'buildId'>;
    return { manifest: { ...body, buildId: buildIdFor(body) } as BuildManifest, bytes };
}

let server: ReturnType<typeof Bun.serve>;
let base: string;
let project: string;
let blobKey: Uint8Array;
let overrides: { blob?: (addr: string, plain: Uint8Array) => Uint8Array; descriptor?: (d: any) => any } = {};
const key = generateSigningKey();
const stranger = generateSigningKey();

const shell = build('shell', 'shell', { 'client/shell.js': 'shell', 'server/shell.cjs': 'shell server' });
const catalog = build('module', 'catalog', { 'client/catalog.js': 'catalog', 'server/catalog.cjs': 'catalog server' });
const snapshot = { id: '', shell: shell.manifest.buildId, modules: { catalog: catalog.manifest.buildId }, libraries: {} };
snapshot.id = snapshotIdFor(snapshot);
const addressOf = (buildId: string, path: string) => sha(`${buildId}\n${path}`);
const allFiles = [...Object.entries(shell.bytes).map(([p, b]) => [shell.manifest.buildId, p, b] as const), ...Object.entries(catalog.bytes).map(([p, b]) => [catalog.manifest.buildId, p, b] as const)];

function signedChannel(signer = key, keyId = key.keyId) {
    const signature = signStatement(signer.privateKey, channelMoveStatement('acme', 'stable', 1, snapshot.id));
    return { name: 'stable', snapshotId: snapshot.id, version: 1, signature: { keyId, signature } };
}

beforeEach(async () => {
    blobKey = randomBytes(32);
    overrides = {};
    server = Bun.serve({ port: 0, async fetch(req) {
        const url = new URL(req.url);
        const p = url.pathname;
        if (p === '/v1/teams/acme/channels/stable') {
            return Response.json({ channel: signedChannel(), snapshot, builds: [shell.manifest, catalog.manifest] });
        }
        if (p === '/v1/teams/acme/key') return Response.json({ key: Buffer.from(blobKey).toString('base64') });
        const downloads = p.match(/^\/v1\/teams\/acme\/builds\/([0-9a-f]+)\/downloads$/);
        if (downloads) {
            const list = allFiles.filter(([id]) => id === downloads[1]).map(([id, path, bytes]) => {
                const address = addressOf(id, path);
                const d = { path, sha256: sha(bytes), size: bytes.length, url: `${base}/blob/${address}`, encryption: { address } };
                return overrides.descriptor ? overrides.descriptor(d) : d;
            });
            return Response.json(list);
        }
        const blob = p.match(/^\/blob\/([0-9a-f]{64})$/);
        if (blob) {
            const [, , bytes] = allFiles.find(([id, path]) => addressOf(id, path) === blob[1])!;
            const plain = overrides.blob ? overrides.blob(blob[1], bytes) : bytes;
            return new Response(sealBlob(blobKey, 'acme', blob[1], plain));
        }
        return Response.json({ error: { code: 'not_found', message: p } }, { status: 404 });
    } });
    base = `http://127.0.0.1:${server.port}`;
    project = await mkdtemp(join(tmpdir(), 'pull-test-'));
});
afterEach(async () => {
    server.stop(true);
    await rm(project, { recursive: true, force: true });
});

const run = (trusted: Record<string, string> | undefined) => pull({
    client: createClient({ registryUrl: base, token: 'test-token', retryDelaysMs: [] }),
    registry: base, team: 'acme', channel: 'stable', project, trustedKeys: trusted,
});

test('a signed channel pulls, verifies every file and writes the lock', async () => {
    const result = await run({ [key.keyId]: key.publicKey });
    expect(result.downloaded).toBe(allFiles.length);
    const lock = JSON.parse(await readFile(join(project, 'hadars.lock'), 'utf8'));
    expect(lock.snapshotId).toBe(snapshot.id);
    expect(lock.channelVersion).toBe(1);
    expect(lock.signature.keyId).toBe(key.keyId);
    const installed = await readFile(join(project, '.hadars', 'builds', catalog.manifest.buildId, 'client/catalog.js'), 'utf8');
    expect(installed).toBe('catalog');
});

test('nothing is installed when the signing key is not trusted', async () => {
    await expect(run({ [stranger.keyId]: stranger.publicKey })).rejects.toThrow('not in the trusted keys');
    await expect(stat(join(project, 'hadars.lock'))).rejects.toThrow();
});

test('a signature that does not match the channel move is refused', async () => {
    // Claims the trusted key, but was made with another key.
    const forged = { ...signedChannel(stranger, key.keyId) };
    server.stop(true);
    server = Bun.serve({ port: 0, fetch: (req) => new URL(req.url).pathname === '/v1/teams/acme/channels/stable'
        ? Response.json({ channel: forged, snapshot, builds: [shell.manifest, catalog.manifest] })
        : Response.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 }) });
    base = `http://127.0.0.1:${server.port}`;
    await expect(run({ [key.keyId]: key.publicKey })).rejects.toThrow('does not match');
    await expect(stat(join(project, 'hadars.lock'))).rejects.toThrow();
});

test('a blob whose content differs from its declared hash is refused', async () => {
    // Same length as the real file, so the size check passes and the hash check is what refuses it.
    overrides.blob = (_addr, plain) => enc('X'.repeat(plain.length));
    await expect(run({ [key.keyId]: key.publicKey })).rejects.toThrow('sha256 mismatch');
    await expect(stat(join(project, 'hadars.lock'))).rejects.toThrow();
});

test('a blob sealed for another team cannot be decrypted', async () => {
    overrides.blob = undefined;
    server.stop(true);
    server = Bun.serve({ port: 0, async fetch(req) {
        const p = new URL(req.url).pathname;
        if (p === '/v1/teams/acme/channels/stable') return Response.json({ channel: signedChannel(), snapshot, builds: [shell.manifest, catalog.manifest] });
        if (p === '/v1/teams/acme/key') return Response.json({ key: Buffer.from(blobKey).toString('base64') });
        const downloads = p.match(/^\/v1\/teams\/acme\/builds\/([0-9a-f]+)\/downloads$/);
        if (downloads) return Response.json(allFiles.filter(([id]) => id === downloads[1]).map(([id, path, bytes]) => ({ path, sha256: sha(bytes), size: bytes.length, url: `${base}/blob/${addressOf(id, path)}`, encryption: { address: addressOf(id, path) } })));
        const blob = p.match(/^\/blob\/([0-9a-f]{64})$/);
        if (blob) { const [, , bytes] = allFiles.find(([id, path]) => addressOf(id, path) === blob[1])!; return new Response(sealBlob(blobKey, 'someone-else', blob[1], bytes)); }
        return Response.json({ error: { code: 'not_found', message: p } }, { status: 404 });
    } });
    base = `http://127.0.0.1:${server.port}`;
    await expect(run({ [key.keyId]: key.publicKey })).rejects.toThrow('wrong key or tampered');
});

test('download metadata that does not match the build is refused', async () => {
    overrides.descriptor = (d) => ({ ...d, size: d.size + 1 });
    await expect(run({ [key.keyId]: key.publicKey })).rejects.toThrow('Download metadata mismatch');
});
