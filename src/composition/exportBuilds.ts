import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PinnedBuild, PinnedBuildsOptions } from './pinnedTypes';
import type { BuildManifest } from './artifacts';
import { readBuildFiles } from './artifacts';
import { computeBuildId, hash } from './identity';
import { resolvePinnedBuilds } from './pinnedBuilds';

/** Validates all pinned bytes before staging declared client assets; returns public data only. */
export async function assemblePinnedExport(options: PinnedBuildsOptions, staticDir: string): Promise<Record<string, PinnedBuild['client']>> {
    const builds = await resolvePinnedBuilds(options);
    const lock = JSON.parse(await readFile(options.lockFile, 'utf8'));
    const clients: Record<string, PinnedBuild['client']> = Object.create(null);
    const copies: Array<{ destination: string; bytes: Buffer }> = [];
    for (const build of Object.values(builds)) {
        const id = path.basename(build.server.dir);
        const manifest: BuildManifest = lock.builds[id].manifest;
        if (computeBuildId(manifest) !== id) throw new Error(`Pinned build "${build.name}": content identity changed during export`);
        const files = readBuildFiles(build.server.dir);
        const declared = new Map(manifest.files.map((f) => [f.path, f]));
        for (const p of files.keys()) if (!declared.has(p)) throw new Error(`Pinned build "${build.name}": undeclared file ${p}`);
        for (const f of manifest.files) {
            const bytes = files.get(f.path);
            if (!bytes) throw new Error(`Pinned build "${build.name}": missing file ${f.path}`);
            if (bytes.length !== f.size || hash(bytes) !== f.sha256) throw new Error(`Pinned build "${build.name}": hash mismatch for ${f.path}`);
        }
        if (build.kind !== 'module') continue;
        const client = { ...build.client, integrity: Object.fromEntries((build.client.files ?? []).map((p) =>
            [p, `sha256-${Buffer.from(declared.get(p)!.sha256, 'hex').toString('base64')}`])) };
        clients[build.name] = client;
        const urlPath = new URL(client.baseUrl, 'https://assets.invalid').pathname;
        for (const p of client.files ?? []) {
            const destination = path.resolve(staticDir, '.' + urlPath, p);
            if (!destination.startsWith(path.resolve(staticDir) + path.sep)) throw new Error(`Unsafe export destination: ${p}`);
            copies.push({ destination, bytes: files.get(p)! });
        }
    }
    // Validate the entire set before writing any assets to the static output.
    for (const { destination, bytes } of copies) {
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes);
    }
    return clients;
}
