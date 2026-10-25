import { rspack } from '@rspack/core';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { CompositionOptions, HadarsOptions } from '../types/hadars';

import { resolveModuleRequires } from './versions';

import { SHARED_GLOBAL, MODULES_GLOBAL, DEFAULT_SHARED, type TargetManifest } from './constants';

type ModuleComposition = Extract<CompositionOptions, { role: 'module' }>;

export interface BuildModuleOptions {
    composition: ModuleComposition;
    /** Project root; `exposes` paths resolve against it. */
    cwd: string;
    outDir: string;
    mode?: 'development' | 'production';
    resolve?: { alias?: Record<string, string | false | string[]>; tsConfig?: string };
    swcPlugins?: HadarsOptions['swcPlugins'];
    /** Fill shared requirements with installed exact versions, or select explicit specifiers. */
    inferRequires?: boolean | string[];
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

export interface ModuleConfigOptions extends BuildModuleOptions {
    target: 'web' | 'node';
    /** Dev client only: emit Fast Refresh call sites and take the refresh runtime from the host. */
    refresh?: boolean;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
const MODULE_NAME = /^[A-Za-z0-9][\w-]*$/;

/** Rejects names that would produce broken file names, globals or generated exports. */
export function validateModule({ name, exposes }: ModuleComposition): void {
    if (!MODULE_NAME.test(name)) {
        throw new Error(`Invalid module name "${name}": use letters, digits, "_" and "-" (it names files and a browser global).`);
    }
    if (Object.keys(exposes).length === 0) throw new Error(`Module "${name}" exposes nothing.`);
    for (const key of Object.keys(exposes)) {
        if (!IDENT.test(key)) throw new Error(`Invalid exposes key "${key}" in module "${name}": it must be a valid JavaScript identifier.`);
    }
}

/** Writes the entry that exposes each file as a namespace and returns its path. */
export function writeBarrel(opts: BuildModuleOptions): string {
    const { composition, cwd, outDir } = opts;
    validateModule(composition);
    // Each exposed file becomes a namespace export, so a host reads module[key].Export.
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'composition.json'), JSON.stringify({ requires: resolveModuleRequires(opts) }));
    const barrel = path.join(outDir, `${composition.name}.entry.js`);
    writeFileSync(barrel, Object.entries(composition.exposes)
        .map(([key, file]) => `export * as ${key} from ${JSON.stringify(path.resolve(cwd, file))};`).join('\n'));
    return barrel;
}

/** The rspack config shared by `buildModule` and the dev server; callers add output and entry. */
export function moduleConfig(opts: ModuleConfigOptions) {
    const { composition, cwd, mode = 'production', target, refresh = false } = opts;
    const shared = [...DEFAULT_SHARED, ...(composition.shared ?? []), ...(refresh ? ['react-refresh/runtime'] : [])];
    return {
        mode,
        devtool: false as const,
        context: cwd,
        target,
        externals: sharedExternals([...new Set(shared)]),
        resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'],
            alias: opts.resolve?.alias,
            tsConfig: opts.resolve?.tsConfig ? path.resolve(cwd, opts.resolve.tsConfig) : undefined },
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
                            ...(opts.swcPlugins?.length ? { experimental: {
                                runPluginFirst: true,
                                cacheRoot: path.join(opts.outDir, '.swc'),
                                plugins: opts.swcPlugins.map((plugin) => {
                                    if (typeof plugin === 'function') throw new Error('Module SWC plugins must be WASM plugin paths or tuples; use a precompiled entry for function transforms.');
                                    return typeof plugin === 'string' ? [plugin, {}] : Array.isArray(plugin) ? plugin : [plugin.path, plugin.options ?? {}];
                                }),
                            } } : {}),
                            parser: { syntax: 'typescript', tsx: true },
                            transform: { react: { runtime: 'automatic', development: refresh, refresh } },
                        },
                    },
                },
            ],
        },
    };
}

/**
 * Builds a module for both targets. Shared packages are externals resolved from
 * the host at load time, so one React instance serves the whole composition.
 * Writes `<outDir>/{client,server}/manifest.json` listing the files to load.
 */
export async function buildModule(opts: BuildModuleOptions): Promise<ModuleBuildResult> {
    const { name } = opts.composition;
    const barrel = writeBarrel(opts);
    const client = await run({
        ...moduleConfig({ ...opts, target: 'web' }),
        entry: { [name]: barrel },
        output: {
            path: path.join(opts.outDir, 'client'),
            filename: '[name].js',
            // Keeps the bundle's chunk-loading globals apart from other modules on the page.
            uniqueName: `hadars-module-${name}`,
            library: { type: 'assign-properties', name: [MODULES_GLOBAL, name] },
        },
    } as any, name);
    const server = await run({
        ...moduleConfig({ ...opts, target: 'node' }),
        entry: { [name]: barrel },
        output: { path: path.join(opts.outDir, 'server'), filename: '[name].cjs', library: { type: 'commonjs2' } },
    } as any, name);

    for (const [dir, manifest] of [['client', client], ['server', server]] as const) {
        mkdirSync(path.join(opts.outDir, dir), { recursive: true });
        writeFileSync(path.join(opts.outDir, dir, 'manifest.json'), JSON.stringify(manifest));
    }
    return { client, server };
}
