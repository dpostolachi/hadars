import { rspack } from '@rspack/core';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { CompositionOptions } from '../types/hadars';

/** Where a host publishes the packages modules import instead of bundling. */
export const SHARED_GLOBAL = '__HADARS_SHARED__';
/** Where a client bundle registers its exports. */
export const MODULES_GLOBAL = '__HADARS_MODULES__';

export const DEFAULT_SHARED = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

export interface TargetManifest {
    js: string[];
    css: string[];
}

export interface BuildModuleOptions {
    composition: CompositionOptions;
    /** Project root; `exposes` paths resolve against it. */
    cwd: string;
    outDir: string;
    mode?: 'development' | 'production';
}

export interface ModuleBuildResult {
    client: TargetManifest;
    server: TargetManifest;
}

const sharedExternals = (shared: string[]) =>
    Object.fromEntries(shared.map((pkg) => [pkg, `var globalThis.${SHARED_GLOBAL}[${JSON.stringify(pkg)}]`]));

const run = (config: Parameters<typeof rspack>[0], name: string): Promise<TargetManifest> =>
    new Promise((resolve, reject) => {
        const compiler = rspack(config);
        compiler.run((err, stats) => {
            if (err) return reject(err);
            if (stats?.hasErrors()) return reject(new Error(stats.toString({ errors: true })));
            const assets = (stats!.toJson({ all: false, entrypoints: true }).entrypoints?.[name]?.assets ?? [])
                .map((a: { name: string }) => a.name);
            compiler.close(() => resolve({
                js: assets.filter((a: string) => /\.c?js$/.test(a)),
                css: assets.filter((a: string) => a.endsWith('.css')),
            }));
        });
    });

/**
 * Builds a module for both targets. Shared packages are externals resolved from
 * the host at load time, so one React instance serves the whole composition.
 * Writes `<outDir>/{client,server}/manifest.json` listing the files to load.
 */
export async function buildModule({ composition, cwd, outDir, mode = 'production' }: BuildModuleOptions): Promise<ModuleBuildResult> {
    const { name, exposes } = composition;
    const externals = sharedExternals([...new Set([...DEFAULT_SHARED, ...(composition.shared ?? [])])]);
    // Each exposed file becomes a namespace export, so a host reads module[key].Export.
    mkdirSync(outDir, { recursive: true });
    const barrel = path.join(outDir, `${name}.entry.js`);
    writeFileSync(barrel, Object.entries(exposes)
        .map(([key, file]) => `export * as ${key} from ${JSON.stringify(path.resolve(cwd, file))};`).join('\n'));

    const base = (target: 'web' | 'node') => ({
        mode,
        devtool: false as const,
        context: cwd,
        target,
        entry: { [name]: barrel },
        externals,
        resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'] },
        experiments: { css: true },
        module: {
            rules: [
                { test: /\.css$/, type: 'css' as const },
                {
                    test: /\.[jt]sx?$/,
                    exclude: /node_modules/,
                    loader: 'builtin:swc-loader',
                    options: {
                        jsc: {
                            parser: { syntax: 'typescript', tsx: true },
                            transform: { react: { runtime: 'automatic', development: mode === 'development' } },
                        },
                    },
                },
            ],
        },
    });

    const client = await run({
        ...base('web'),
        output: {
            path: path.join(outDir, 'client'),
            filename: '[name].js',
            library: { type: 'assign-properties', name: [MODULES_GLOBAL, name] },
        },
    } as any, name);
    const server = await run({
        ...base('node'),
        output: { path: path.join(outDir, 'server'), filename: '[name].cjs', library: { type: 'commonjs2' } },
    } as any, name);

    for (const [dir, manifest] of [['client', client], ['server', server]] as const) {
        mkdirSync(path.join(outDir, dir), { recursive: true });
        writeFileSync(path.join(outDir, dir, 'manifest.json'), JSON.stringify(manifest));
    }
    return { client, server };
}
