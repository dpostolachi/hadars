import { expect, test } from 'bun:test';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const entry = join(import.meta.dir, '../src/utils/ssrHandler.ts');

test('server gzip round trips with streams and with the native fallback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'compression-server-'));
    try {
        const file = join(dir, 'compression.mjs');
        await build({ entryPoints: [entry], outfile: file, bundle: true, platform: 'node', format: 'esm' });
        const script = join(dir, 'round-trip.mjs');
        await writeFile(script, `import { gzipCompress, gzipDecompress } from './compression.mjs';
            import { strict as assert } from 'node:assert';
            const input = new TextEncoder().encode('cached response ☃ '.repeat(100));
            for (const fallback of [false, true]) {
                if (fallback) {
                    globalThis.CompressionStream = undefined;
                    globalThis.DecompressionStream = undefined;
                }
                const zipped = await gzipCompress(input);
                assert.deepEqual([...zipped.slice(0, 2)], [31, 139]);
                assert.deepEqual([...await gzipDecompress(zipped)], [...input]);
            }`);
        const child = Bun.spawn(['node', script], { stdout: 'pipe', stderr: 'pipe' });
        const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        expect(stderr).toBe('');
        expect(status).toBe(0);
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('edge gzip has no native specifiers and requires the corresponding stream API', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'compression-edge-'));
    const compression = globalThis.CompressionStream;
    const decompression = globalThis.DecompressionStream;
    try {
        const file = join(dir, 'compression.mjs');
        await build({ entryPoints: [entry], outfile: file, bundle: true, platform: 'browser', format: 'esm',
            define: { __EDGE_RUNTIME__: 'true', global: 'globalThis' } });
        expect(await readFile(file, 'utf8')).not.toMatch(/["'`]node:[^"'`]+["'`]/);
        const { gzipCompress, gzipDecompress } = await import(file);
        const input = new TextEncoder().encode('cached response');
        const zipped = await gzipCompress(input);
        expect(await gzipDecompress(zipped)).toEqual(input);
        Object.assign(globalThis, { CompressionStream: undefined, DecompressionStream: undefined });
        await expect(gzipCompress(input)).rejects.toThrow('Gzip compression requires CompressionStream in this edge runtime');
        await expect(gzipDecompress(zipped)).rejects.toThrow('Gzip decompression requires DecompressionStream in this edge runtime');
    } finally {
        Object.assign(globalThis, { CompressionStream: compression, DecompressionStream: decompression });
        await rm(dir, { recursive: true, force: true });
    }
});
