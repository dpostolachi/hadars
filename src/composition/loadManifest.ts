import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MANIFEST_FILES, validateManifest, type HadarsManifest } from './manifest';

/** Finds and loads `hadars.manifest.*` in `dir`; `exposes` paths resolve against that directory. */
export async function loadManifest(dir: string): Promise<{ manifest: HadarsManifest; file: string; cwd: string }> {
    const cwd = path.resolve(dir);
    const file = MANIFEST_FILES.map((name) => path.join(cwd, name)).find((candidate) => existsSync(candidate));
    if (!file) throw new Error(`No hadars.manifest.ts in ${cwd}`);
    const mod = await import(pathToFileURL(file).href);
    const manifest = (mod?.default ?? mod) as HadarsManifest;
    validateManifest(manifest);
    return { manifest, file, cwd };
}
