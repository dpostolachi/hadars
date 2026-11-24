import { verifyBuildFiles } from './manifest';
import type { BuildManifest } from '../registry-protocol';
import { ApiError, type Client } from './client';

export interface PublishOptions {
    client: Client;
    team: string;
    /** Directory the manifest's file paths are relative to. */
    outDir: string;
    manifest: BuildManifest;
    /** Parallel uploads. */
    concurrency?: number;
    progress?: (message: string) => void;
}

export interface PublishResult {
    buildId: string;
    /** `exists`: the registry already had this exact build, nothing was uploaded. */
    status: 'exists' | 'published';
    uploaded: number;
    skipped: number;
}

/** declare -> upload only what the registry asked for -> finalize. */
export async function publishBuild({ client, team, outDir, manifest, concurrency = 8, progress }: PublishOptions): Promise<PublishResult> {
    const files = verifyBuildFiles(outDir, manifest);
    const root = `/v1/teams/${encodeURIComponent(team)}`;
    const retry = async (work: () => Promise<any>) => {
        for (let attempt = 0; ; attempt++) {
            try { return await work(); } catch (error) {
                if (attempt >= 3 || !(error instanceof ApiError) || !['conflict', 'unreachable', 'internal', '502', '503', '504'].includes(error.code)) throw error;
                await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
            }
        }
    };
    let declared = await retry(() => client.request('POST', `${root}/builds/declare`, manifest));
    if (declared.status === 'exists') {
        return { buildId: manifest.buildId, status: 'exists', uploaded: 0, skipped: manifest.files.length };
    }

    let uploaded = 0;
    const seen = new Set<string>();
    do {
        const queue: Array<{ path: string; upload: { url: string; method: string } }> = declared.uploads.filter((u: { sha256: string }) => !seen.has(u.sha256));
        for (const u of declared.uploads) seen.add(u.sha256);
        uploaded += queue.length;
        const worker = async () => {
            for (let next = queue.shift(); next; next = queue.shift()) {
                const bytes = files.get(next.path);
                if (!bytes) throw new ApiError('invalid', 'Registry requested an undeclared file');
                const res = await fetch(next.upload.url, { method: next.upload.method, body: new Uint8Array(bytes) });
                if (!res.ok) throw new ApiError('upload_failed', `uploading ${next.path} failed: ${res.status} ${(await res.text()).slice(0, 120)}`);
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, declared.uploads.length) }, worker));

        if (declared.next === undefined) break;
        const cursor = encodeURIComponent(declared.next);
        declared = await retry(() => client.request('POST', `${root}/builds/declare?cursor=${cursor}`, manifest));
    } while (declared.status !== 'exists');

    for (;;) {
        const result = await retry(() => client.request('POST', `${root}/builds/${encodeURIComponent(manifest.buildId)}/finalize`));
        if (result.status !== 'pending') break; // Older servers return the manifest immediately.
        progress?.(`finalizing ${result.verified}/${result.total}`);
    }
    return {
        buildId: manifest.buildId,
        status: 'published',
        uploaded,
        skipped: new Set(manifest.files.map((f) => f.sha256)).size - uploaded,
    };
}
