import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadArtifact } from '../../src/deploy/bunny/artifact';
import { outputHash, verifyOutput } from '../../src/deploy/bunny/output';
import { BunnyTarget } from '../../src/deploy/bunny';
import { sealFixture } from './helpers/seal';

// Read-only dev conformance dependency; never part of the runtime.
const nativeSource = new URL('../../src/composition/exportIntegrity.ts', import.meta.url).pathname;
test.skipIf(!await Bun.file(nativeSource).exists())('native export-integrity fixture conforms, including byte/hash/missing/extra differences', async () => {
    const native = await import(nativeSource);
    const root = await mkdtemp(join(tmpdir(), 'output-conformance-'));
    try {
        // Same entry/nested asset/template fixture as hadars test/export-integrity.test.ts,
        // in the deployment layout.
        const staticDir = join(root, '.hadars/static'), metadataPath = '.hadars/static/composition-provenance.json';
        await mkdir(join(staticDir, 'nested'), { recursive: true });
        await writeFile(join(root, 'bunny.mjs'), 'export default 1;');
        await writeFile(join(staticDir, 'nested/asset.js'), 'asset');
        await writeFile(join(staticDir, 'out.html'), '<html/>');
        await writeFile(join(root, metadataPath), JSON.stringify({ snapshot: 'snapshot', shell: 'shell', modules: {} }));
        const sealed = native.finalizeExport(root, join(root, 'bunny.mjs'), staticDir);
        const verified = verifyOutput(await loadArtifact(root));
        expect(verified).toEqual({ scriptSha256: sealed.entry.sha256, staticSha256: sealed.static.sha256, metadataSha256: sealed.metadataSha256, allowUnboundOutput: false, adapted: false });
        const error = (fn: () => unknown) => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };
        for (const path of ['bunny.mjs', '.hadars/static/nested/asset.js', '.hadars/static/out.html']) {
            const original = await readFile(join(root, path)), changed = Buffer.from(original); changed[0] ^= 1;
            await writeFile(join(root, path), changed);
            const artifact = await loadArtifact(root);
            expect(error(() => verifyOutput(artifact))).toBe(error(() => native.verifyExport(root, metadataPath)));
            await writeFile(join(root, path), original);
        }
        await rm(join(staticDir, 'nested/asset.js')); await writeFile(join(staticDir, 'extra.txt'), 'extra');
        const artifact = await loadArtifact(root);
        expect(error(() => verifyOutput(artifact))).toBe(error(() => native.verifyExport(root, metadataPath)));
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('Bunny publishes exactly captured verified bytes and refuses altered or invalid UTF-8 before I/O', async () => {
    for (const bytes of [Buffer.from('\ufeffexport default "é";'), new Uint8Array([255])]) {
        const artifact = { entry: 'bunny.mjs', files: [{ path: 'bunny.mjs', bytes }] };
        sealFixture(artifact, { snapshot: 'snapshot', shell: 'shell', modules: {} });
        const outputVerification = verifyOutput(artifact);
        const calls: string[] = [];
        const target = new BunnyTarget({ key: 'mock', publicZoneId: '1', storageZone: 'mock', storageKey: 'mock' }, (async (_url, init) => {
            calls.push('storage'); return new Response(init?.method === 'PUT' ? '' : artifact.files.at(-1)!.bytes);
        }) as typeof fetch, {
            async request(method, path) {
                calls.push(method);
                if (method === 'POST') return { Id: 1 };
                // Mutation after stage starts cannot affect captured script bytes.
                if (path === '/compute/script') { artifact.files[0].bytes = Buffer.from('changed'); return []; }
                if (path === '/pullzone') return [];
                return { DefaultHostname: 'demo.bunny.run' };
            },
            async publish(_id, code) { calls.push('publish'); expect(outputHash(Buffer.from(code))).toBe(outputVerification.scriptSha256); },
        });
        const plan = { ...target.plan({ project: 'demo', environment: 'dev', revision: 1, artifact }), outputVerification };
        if (bytes[0] === 255) {
            await expect(target.stage(plan)).rejects.toThrow(); expect(calls).toEqual([]);
        } else {
            await target.stage(plan); expect(calls).toContain('publish');
            calls.length = 0;
            await expect(target.stage(plan)).rejects.toThrow('Entry script changed: bunny.mjs'); expect(calls).toEqual([]);
        }
    }
});

test('staging refuses adapted-byte substitution before provider I/O', async () => {
    const artifact = { entry: 'bunny.mjs', files: [{ path: 'bunny.mjs', bytes: Buffer.from('original') }] };
    sealFixture(artifact, { snapshot: 'snapshot', shell: 'shell', modules: {} });
    const target = new BunnyTarget({ key: 'mock', publicZoneId: '1', storageZone: 'mock', storageKey: 'mock' }, (async () => { throw new Error('Unexpected provider I/O'); }) as unknown as typeof fetch,
        { async request() { throw new Error('Unexpected provider I/O'); }, async publish() { throw new Error('Unexpected publish'); } });
    const adaptedScript = Buffer.from('adapted');
    const plan = { ...target.plan({ project: 'demo', environment: 'dev', revision: 1, artifact }), adaptedScript,
        outputVerification: { ...verifyOutput(artifact), adapted: true, adaptedSha256: outputHash(adaptedScript) } };
    adaptedScript[0] ^= 1;
    await expect(target.stage(plan)).rejects.toThrow('Staged script differs from verified script');
});
