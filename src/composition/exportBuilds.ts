import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PinnedBuild, PinnedBuildsOptions } from './pinnedTypes';
import type { BuildManifest } from './artifacts';
import { readBuildFiles } from './artifacts';
import { computeBuildId, hash } from './identity';
import { linkServer } from './linkServer';
import { resolvePinnedBuilds } from './pinnedBuilds';

/** Validates all pinned bytes before staging declared client assets; returns public data only. */
export async function assemblePinnedExport(options: PinnedBuildsOptions, staticDir: string, link?: { file: string; runtime: string; modules?: string[]; onLinkedBytes?: (bytes: number) => void }): Promise<Record<string, PinnedBuild['client']>> {
    const builds = await resolvePinnedBuilds(options);
    const lock = JSON.parse(await readFile(options.lockFile, 'utf8'));
    const clients: Record<string, PinnedBuild['client']> = Object.create(null);
    const registrations: string[] = [];
    const provenance = { snapshot: lock.snapshotId, shell: lock.snapshot.shell,
        modules: {} as Record<string, { buildId: string; clientOnly: boolean; server: BuildManifest['files']; client: BuildManifest['files'] }> };
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
        const serverFiles = manifest.files.filter((f) => f.path.startsWith('server/') || [...manifest.targets.server.js, ...manifest.targets.server.css].includes(f.path));
        provenance.modules[build.name] = { buildId: id, clientOnly: !!manifest.clientOnly,
            server: manifest.clientOnly ? [] : serverFiles, client: manifest.files.filter((f) => client.files?.includes(f.path)) };
        if (link && !manifest.clientOnly && (!link.modules || link.modules.includes(build.name))) {
            const linked = await linkServer(build.name, manifest.targets.server.js[0]!, files);
            provenance.modules[build.name]!.server = manifest.files.filter((f) => linked.files.includes(f.path));
            link.onLinkedBytes?.(Buffer.byteLength(linked.factory));
            registrations.push(`registerLinkedModule(${JSON.stringify(build.name)}, ${linked.factory});`);
            console.log(`Linked module "${build.name}" (${id}): ${Buffer.byteLength(linked.factory)} linked bytes; ${provenance.modules[build.name]!.server.reduce((n, f) => n + f.size, 0)} server input bytes`);
        }
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
    await mkdir(staticDir, { recursive: true });
    await writeFile(path.join(staticDir, 'composition-provenance.json'), JSON.stringify(provenance, null, 2));
    if (link) await writeFile(link.file, `import { registerLinkedModule } from ${JSON.stringify(link.runtime)};\n${registrations.join('\n')}\n`);
    return clients;
}
