import path from 'node:path';
import { loadManifest } from './loadManifest';
import { manifestComposition } from './manifest';
import { buildModule, type BuildModuleOptions, type ModuleBuildResult } from './moduleBuild';

export type ManifestBuildOptions = Omit<BuildModuleOptions, 'composition' | 'manifest' | 'cwd' | 'outDir'> & { outDir?: string };

/** Everything `buildModule` needs, read from the `hadars.manifest.ts` in `dir`. */
export async function moduleOptionsFromManifest(dir: string, opts: ManifestBuildOptions = {}): Promise<BuildModuleOptions> {
    const { manifest, cwd } = await loadManifest(dir);
    return { ...opts, composition: manifestComposition(manifest), manifest, cwd,
        outDir: path.resolve(opts.outDir ?? path.join(cwd, '.hadars', 'module')) };
}

/** Builds the module described by the `hadars.manifest.ts` in `dir`. */
export async function buildModuleFromManifest(dir: string, opts: ManifestBuildOptions = {}): Promise<ModuleBuildResult & { options: BuildModuleOptions }> {
    const options = await moduleOptionsFromManifest(dir, opts);
    return { ...(await buildModule(options)), options };
}
