import rspack from "@rspack/core";
import type { Configuration, RuleSetLoaderWithOptions, RuleSetRule } from "@rspack/core";
import ReactRefreshPlugin from '@rspack/plugin-react-refresh';
import path from 'node:path';
import type { SwcPluginList } from '../types/hadars';
import { fileURLToPath } from "node:url";
import pathMod from "node:path";
import { existsSync } from "node:fs";

const __dirname = process.cwd();
const packageDir = pathMod.dirname(fileURLToPath(import.meta.url));
const clientScriptPath = pathMod.resolve(packageDir, 'template.html');

// When running from compiled dist/cli.js the loader is pre-built as loader.cjs.
// The .cjs extension forces CommonJS regardless of the package "type": "module".
// When running from source (bun/tsx) it falls back to loader.ts.
const loaderPath = existsSync(pathMod.resolve(packageDir, 'loader.cjs'))
    ? pathMod.resolve(packageDir, 'loader.cjs')
    : pathMod.resolve(packageDir, 'loader.ts');

const getConfigBase = (mode: "development" | "production"): Omit<Configuration, "entry" | "output" | "plugins"> => {
    const isDev = mode === 'development';
    return {
        experiments: {
            css: true,
            outputModule: true,
        },
        resolve: {
            modules: [
                path.resolve(__dirname, 'node_modules'),
                // 'node_modules' (relative) enables the standard upward-traversal
                // resolution so rspack can find transitive deps (e.g. webpack-dev-server)
                // that live in a parent node_modules when running from a sub-project.
                'node_modules',
            ],
            tsConfig: path.resolve(__dirname, 'tsconfig.json'),
            extensions: ['.tsx', '.ts', '.js', '.jsx'],
        },
        module: {
            rules: [
                {
                    test: /\.mdx?$/,
                    use: [
                    {
                        loader: '@mdx-js/loader',
                        options: {
                        },
                    },
                    ],
                },
                {
                    test: /\.css$/,
                    use: ["postcss-loader"],
                    type: "css",
                },
                {
                    test: /\.svg$/i,
                    issuer: /\.[jt]sx?$/,
                    use: ['@svgr/webpack'],
                },
                {
                    test: /\.m?jsx?$/,
                    resolve: {
                        fullySpecified: false,
                    },
                    exclude: [loaderPath],
                    use: [
                        // Transforms loadModule('./path') based on build target.
                        // Runs before swc-loader (loaders execute right-to-left).
                        {
                            loader: loaderPath,
                        },
                        {
                            loader: 'builtin:swc-loader',
                            options: {
                                jsc: {
                                    parser: {
                                        syntax: 'ecmascript',
                                        jsx: true,
                                    },
                                    transform: {
                                        react: {
                                            runtime: "automatic",
                                            development: isDev,
                                            refresh: isDev,
                                        },
                                    },
                                },
                            },
                        },
                    ],
                    type: 'javascript/auto',
                },
                {
                    test: /\.tsx?$/,
                    resolve: {
                        fullySpecified: false,
                    },
                    exclude: [loaderPath],
                    use: [
                        {
                            loader: loaderPath,
                        },
                        {
                            loader: 'builtin:swc-loader',
                            options: {
                                jsc: {
                                    parser: {
                                        syntax: 'typescript',
                                        tsx: true,
                                    },
                                    transform: {
                                        react: {
                                            runtime: "automatic",
                                            development: isDev,
                                            refresh: isDev,
                                        },
                                    },
                                },
                            },
                        },
                    ],
                    type: 'javascript/auto',
                },
            ],
        },
    }
}

type EntryOutput = Configuration["output"];

interface EntryOptions {
    target: Configuration["target"],
    output: EntryOutput,
    mode: "development" | "production",
    // optional swc plugins to pass to swc-loader
    swcPlugins?: SwcPluginList,
    // optional path to a custom HTML template (resolved relative to cwd)
    htmlTemplate?: string,
    // optional compile-time defines (e.g. { 'process.env.NODE_ENV': '"development"' })
    define?: Record<string, string>;
    base?: string;
    // optional rspack optimization overrides (production client builds only)
    optimization?: Record<string, unknown>;
}

const buildCompilerConfig = (
    entry: string,
    opts: EntryOptions,
    includeHotPlugin: boolean,
): Configuration => {
    const Config = getConfigBase(opts.mode);
    const { base } = opts;
    const isDev = opts.mode === 'development';

    // shallow-clone base config to avoid mutating shared Config while preserving RegExp and plugin instances
    const localConfig: any = {
        ...Config,
        module: {
            ...Config.module,
            rules: (Config.module && Array.isArray(Config.module.rules) ? Config.module.rules : []).map((r: any) => {
                // shallow copy each rule and its 'use' array/entries so we can mutate safely
                const nr: any = { ...r };
                if (r && Array.isArray(r.use)) {
                    nr.use = r.use.map((u: any) => ({ ...(typeof u === 'object' ? u : { loader: u }) }));
                }
                return nr;
            }),
        },
    };

    // if swc plugins are provided, inject them into swc-loader options for js/jsx and ts/tsx rules
    if (opts.swcPlugins && Array.isArray(opts.swcPlugins) && opts.swcPlugins.length > 0) {
        const rules = localConfig.module && localConfig.module.rules;
        if (Array.isArray(rules)) {
            for (const rule of rules) {
                const ruleUse = rule as RuleSetRule;
                if (ruleUse.use && Array.isArray(ruleUse.use)) {
                    for (const entry of ruleUse.use ) {
                        const useEntry = entry as RuleSetLoaderWithOptions;
                        if (useEntry && useEntry.loader && typeof useEntry.loader === 'string' && useEntry.loader.includes('swc-loader')) {
                            const options = ( useEntry.options || {} ) as  Record<string, any>;
                            useEntry.options = options;
                            useEntry.options.jsc = useEntry.options.jsc || {};
                            useEntry.options.jsc.experimental = useEntry.options.jsc.experimental || {};
                            // ensure plugins run before other transforms (important for Relay plugin)
                            useEntry.options.jsc.experimental.runPluginFirst = true;
                            // existing plugins may be present under jsc.experimental.plugins; merge them with provided ones
                            const existingPlugins = Array.isArray(useEntry.options.jsc.experimental.plugins) ? useEntry.options.jsc.experimental.plugins : [];
                            const incomingPlugins = Array.isArray(opts.swcPlugins) ? opts.swcPlugins : [];
                            // simple dedupe by plugin name (first element of tuple) to avoid duplicates
                            const seen = new Set<string>();
                            const merged: any[] = [];
                            for (const p of existingPlugins.concat(incomingPlugins)) {
                                // plugin can be [name, options] or string; normalize
                                const name = Array.isArray(p) && p.length > 0 ? String(p[0]) : String(p);
                                if (!seen.has(name)) {
                                    seen.add(name);
                                    merged.push(p);
                                }
                            }
                            useEntry.options.jsc.experimental.plugins = merged;
                        }
                    }
                }
            }
        }
    }

    // For server (SSR) builds we should avoid bundling react/react-dom so
    // the runtime uses the same React instance as the host. If the output
    // is a library/module (i.e. `opts.output.library` present or filename
    // contains "ssr"), treat it as a server build and mark react/react-dom
    // as externals and alias React imports to the project's node_modules.
    const isServerBuild = Boolean(
        (opts.output && typeof opts.output === 'object' && (opts.output.library || String(opts.output.filename || '').includes('ssr')))
    );

    const resolveAliases: Record<string, string> | undefined = isServerBuild ? {
        // force all react imports to resolve to this project's react
        react: path.resolve(process.cwd(), 'node_modules', 'react'),
        'react-dom': path.resolve(process.cwd(), 'node_modules', 'react-dom'),
        // also map react/jsx-runtime to avoid duplicates when automatic runtime is used
        'react/jsx-runtime': path.resolve(process.cwd(), 'node_modules', 'react', 'jsx-runtime.js'),
        'react/jsx-dev-runtime': path.resolve(process.cwd(), 'node_modules', 'react', 'jsx-dev-runtime.js'),
        // ensure emotion packages resolve to the project's node_modules so we don't pick up a browser-specific entry
        '@emotion/react': path.resolve(process.cwd(), 'node_modules', '@emotion', 'react'),
        '@emotion/server': path.resolve(process.cwd(), 'node_modules', '@emotion', 'server'),
        '@emotion/cache': path.resolve(process.cwd(), 'node_modules', '@emotion', 'cache'),
        '@emotion/styled': path.resolve(process.cwd(), 'node_modules', '@emotion', 'styled'),
    } : undefined;

    const externals = isServerBuild ? [
        'react',
        'react-dom',
        // keep common aliases external as well
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        // emotion should be external on server builds to avoid client/browser code
        '@emotion/react',
        '@emotion/server',
        '@emotion/cache',
        '@emotion/styled',
    ] : undefined;

    const extraPlugins: any[] = [];
    if (opts.define && typeof opts.define === 'object') {
        // rspack's DefinePlugin shape mirrors webpack's DefinePlugin
        const DefinePlugin = (rspack as any).DefinePlugin || (rspack as any).plugins?.DefinePlugin;
        if (DefinePlugin) {
            extraPlugins.push(new DefinePlugin(opts.define));
        } else {
            // fallback: try to inject via plugin API name
            extraPlugins.push({ name: 'DefinePlugin', value: opts.define });
        }
    }

    const resolveConfig: any = {
        extensions: ['.tsx', '.ts', '.js', '.jsx'],
        alias: resolveAliases,
        // for server builds prefer the package "main"/"module" fields and avoid "browser" so we don't pick browser-specific entrypoints
        mainFields: isServerBuild ? ['main', 'module'] : ['browser', 'module', 'main'],
    };

    // Production client builds get vendor splitting and deterministic module IDs.
    // User-supplied optimization is merged on top so it can extend or override defaults.
    // Dev and SSR builds skip this — splitChunks slows HMR, SSR uses externals instead.
    const optimization: any = (!isServerBuild && !isDev) ? {
        moduleIds: 'deterministic',
        splitChunks: {
            chunks: 'all',
            cacheGroups: {
                react: {
                    test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                    name: 'vendor-react',
                    chunks: 'all' as const,
                    priority: 20,
                },
            },
        },
        ...(opts.optimization ?? {}),
    } : (opts.optimization ? { ...opts.optimization } : undefined);

    return {
        entry,
        output: {
            ...opts.output,
            clean: false,
        },
        mode: opts.mode,
        externals,
        ...(optimization !== undefined ? { optimization } : {}),
        plugins: [
            new rspack.HtmlRspackPlugin({
                publicPath: base || '/',
                template: opts.htmlTemplate
                    ? pathMod.resolve(process.cwd(), opts.htmlTemplate)
                    : clientScriptPath,
                scriptLoading: 'module',
                filename: 'out.html',
                inject: 'body',
            }),
            isDev && new ReactRefreshPlugin(),
            includeHotPlugin && isDev && new rspack.HotModuleReplacementPlugin(),
            ...extraPlugins,
        ],
        ...localConfig,
        // Merge base resolve (modules, tsConfig, extensions) with per-build resolve
        // (alias, mainFields). The spread order matters: resolveConfig wins for keys
        // it defines, localConfig.resolve wins for keys it defines exclusively.
        resolve: {
            ...localConfig.resolve,
            ...resolveConfig,
        },
        // HMR is not implemented for module chunk format, so disable outputModule
        // for client builds. SSR builds still need it for dynamic import() of exports.
        experiments: {
            ...(localConfig.experiments || {}),
            outputModule: isServerBuild,
        },
        // Prevent rspack from watching its own build output — without this the
        // SSR watcher writing .hadars/index.ssr.js triggers the client compiler
        // and vice versa, causing an infinite rebuild loop.
        watchOptions: {
            ignored: ['**/node_modules/**', '**/.hadars/**'],
        },
    };
};

/**
 * Creates a configured rspack compiler for the client bundle without running it.
 * Intended for use with RspackDevServer for proper HMR support.
 * HotModuleReplacementPlugin is intentionally omitted — RspackDevServer adds it automatically.
 */
export const createClientCompiler = (entry: string, opts: EntryOptions) => {
    return rspack(buildCompilerConfig(entry, opts, false));
};

export const compileEntry = async (entry: string, opts: EntryOptions & { watch?: boolean, onChange?: (stats:any)=>void }) => {
    const compiler = rspack(buildCompilerConfig(entry, opts, true));

    // If watch mode is requested, start watching and invoke onChange for each rebuild.
    // The returned promise resolves once the first build completes so callers can
    // await initial build completion before starting their own server.
    if (opts.watch) {
        await new Promise((resolve, reject) => {
            let first = true;
            // Pass ignored patterns directly — compiler.watch(watchOptions) replaces
            // the config-level watchOptions, so we must repeat them here.
            compiler.watch({ ignored: ['**/node_modules/**', '**/.hadars/**'] }, (err: any, stats: any) => {
                if (err) {
                    if (first) { first = false; reject(err); }
                    else { console.error('rspack watch error', err); }
                    return;
                }

                console.log(stats?.toString({ colors: true }));

                if (first) {
                    first = false;
                    resolve(stats);
                } else {
                    try {
                        opts.onChange && opts.onChange(stats);
                    } catch (e) {
                        console.error('onChange handler error', e);
                    }
                }
            });
        });
        return;
    }

    // non-watch: do a single run and resolve when complete
    await new Promise((resolve, reject) => {
        compiler.run((err: any, stats: any) => {
            if (err) {
                reject(err);
                return;
            }

            console.log(stats?.toString({
                colors: true,
                modules: true,
                children: true,
                chunks: true,
                chunkModules: true,
            }));

            resolve(stats);
        });
    });
}
