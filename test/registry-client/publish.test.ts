import { test, expect, beforeEach, afterEach } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIdFor, type BuildManifest } from '../../src/registry-protocol';
import { createClient } from '../../src/registry-client/client';
import { publishBuild } from '../../src/registry-client/publish';

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const enc = (s: string) => new TextEncoder().encode(s);

let server: ReturnType<typeof Bun.serve>;
let base: string;
let out: string;
let declared = new Set<string>();
let uploaded: string[] = [];
let finalized: string[] = [];

const files = { 'client/catalog.js': 'catalog', 'server/catalog.cjs': 'catalog server' };
const body = { kind: 'module' as const, name: 'catalog', runtimeContract: '2', flavour: 'production' as const, exposes: ['catalog'], shared: [], provides: {}, requires: {},
    targets: { client: { js: ['client/catalog.js'], css: [] }, server: { js: ['server/catalog.cjs'], css: [] } },
    files: Object.entries(files).map(([p, c]) => ({ path: p, size: enc(c).length, sha256: sha(c) })) };
const manifest = { ...body, buildId: buildIdFor(body) } as BuildManifest;

beforeEach(async () => {
    declared = new Set(); uploaded = []; finalized = [];
    out = await mkdtemp(join(tmpdir(), 'publish-test-'));
    for (const [p, c] of Object.entries(files)) { await mkdir(join(out, p.split('/')[0]), { recursive: true }); await writeFile(join(out, p), c); }
    server = Bun.serve({ port: 0, async fetch(req) {
        const u = new URL(req.url);
        if (req.method === 'POST' && u.pathname === '/v1/teams/acme/builds/declare') {
            const m: any = await req.json();
            if (declared.has(m.buildId)) return Response.json({ status: 'exists', buildId: m.buildId, uploads: [] });
            declared.add(m.buildId);
            return Response.json({ status: 'pending', buildId: m.buildId, uploads: m.files.map((f: any) => ({ path: f.path, sha256: f.sha256, upload: { url: `${base}/put/${f.sha256}`, method: 'PUT' } })) });
        }
        if (req.method === 'PUT' && u.pathname.startsWith('/put/')) { uploaded.push(u.pathname); return new Response(null, { status: 200 }); }
        const fin = u.pathname.match(/^\/v1\/teams\/acme\/builds\/([0-9a-f]+)\/finalize$/);
        if (req.method === 'POST' && fin) { finalized.push(fin[1]); return Response.json({ status: 'published', buildId: fin[1] }); }
        return Response.json({ error: { code: 'not_found', message: u.pathname } }, { status: 404 });
    } });
    base = `http://127.0.0.1:${server.port}`;
});
afterEach(async () => {
    server.stop(true);
    await rm(out, { recursive: true, force: true });
});

const publish = (m: BuildManifest = manifest) => publishBuild({
    client: createClient({ registryUrl: base, token: 'test-token', retryDelaysMs: [] }), team: 'acme', outDir: out, manifest: m,
});

test('a new build is declared, every file is uploaded, and the build is finalized', async () => {
    const result = await publish();
    expect(result.status).toBe('published');
    expect(result.uploaded).toBe(2);
    expect(uploaded.length).toBe(2);
    expect(finalized).toEqual([manifest.buildId]);
});

test('a build the registry already holds uploads nothing', async () => {
    await publish();
    uploaded = []; finalized = [];
    const again = await publish();
    expect(again.status).toBe('exists');
    expect(uploaded).toEqual([]);
    expect(finalized).toEqual([]);
});

test('a file that differs from its declaration is not published', async () => {
    await writeFile(join(out, 'client/catalog.js'), 'tampered');
    await expect(publish()).rejects.toThrow();
    expect(finalized).toEqual([]);
});
