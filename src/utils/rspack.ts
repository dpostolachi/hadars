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

const getConfigBase = (mode: "development" | "production", isServerBuild = false): Omit<Configuration, "entry" | "output" | "plugins"> => {
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
                    test: /\.css$/,
                    use: [{ loader: "builtin:lightningcss-loader" }],
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
                    // node_modules is excluded entirely, not just from React
                    // Refresh: see the long comment above createClientCompiler
                    // for why running the refresh transform/loader over
                    // pre-bundled vendor code (which necessarily includes
                    // hadars's own dist/index.js, pulled into every client
                    // entry) is actively unsafe, not just wasteful.
                    exclude: [loaderPath, /node_modules/],
                    use: [
                        // Transforms loadModule('./path') based on build target.
                        // Runs before swc-loader (loaders execute right-to-left).
                        {
                            loader: loaderPath,
                            options: { server: isServerBuild },
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
                                            // Disabled — see the long comment above createClientCompiler
                                            // for why. Short version: three separate attempts to wire
                                            // React Refresh's runtime correctly (excluding node_modules,
                                            // re-adding the loader, fixing double plugin registration)
                                            // each fixed the specific symptom reported but the underlying
                                            // "the transform emits $RefreshReg$(...) calls and nothing
                                            // reliably defines the helper" gap kept resurfacing in a new
                                            // shape against real-world app structures this couldn't be
                                            // reproduced against directly. Disabling the transform removes
                                            // every call site, so there's nothing left to be undefined.
                                            refresh: false,
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
                    // See the matching comment in the .jsx rule above.
                    exclude: [loaderPath, /node_modules/],
                    use: [
                        {
                            loader: loaderPath,
                            options: { server: isServerBuild },
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
                                            // See the matching comment in the .jsx rule above.
                                            refresh: false,
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
    // additional module rules appended after the built-in rules
    moduleRules?: Record<string, any>[];
    // additional rspack/webpack-compatible plugins (applied after built-in plugins)
    plugins?: Array<{ apply(compiler: any): void }>;
    // PostCSS plugins to pass to postcss-loader (replaces the default builtin:lightningcss-loader).
    // Use this when you need PostCSS transforms such as Tailwind CSS v4 (@tailwindcss/postcss).
    postcssPlugins?: any[];
    // force React runtime mode independently of build mode (client only)
    reactMode?: 'development' | 'production';
}

const buildCompilerConfig = (
    entry: string,
    opts: EntryOptions,
    includeHotPlugin: boolean,
): Configuration => {
    const { base } = opts;
    const isDev = opts.mode === 'development';
    const isServerBuild = Boolean(
        (opts.output && typeof opts.output === 'object' && (opts.output.library || String(opts.output.filename || '').includes('ssr')))
    );
    const Config = getConfigBase(opts.mode, isServerBuild);

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

    // If postcssPlugins are provided, swap the default lightningcss-loader CSS rule
    // for postcss-loader with the given plugins.
    if (opts.postcssPlugins && opts.postcssPlugins.length > 0) {
        const rules: any[] = localConfig.module?.rules ?? [];
        for (const rule of rules) {
            if (rule?.test instanceof RegExp && rule.test.source === '\\.css$') {
                rule.use = [{
                    loader: 'postcss-loader',
                    options: { postcssOptions: { plugins: opts.postcssPlugins } },
                }];
                break;
            }
        }
    }

    if (opts.moduleRules && opts.moduleRules.length > 0) {
        localConfig.module.rules.push(...opts.moduleRules);
    }

    // slim-react: the SSR-only React-compatible renderer bundled with hadars.
    // On server builds we replace the real React with slim-react so that hooks
    // get safe SSR stubs, context works, and renderToStream / Suspense are
    // natively supported.  The client build is untouched and uses real React.
    const slimReactIndex = pathMod.resolve(packageDir, 'slim-react', 'index.js');
    const slimReactJsx   = pathMod.resolve(packageDir, 'slim-react', 'jsx-runtime.js');

    const resolveAliases: Record<string, string> | undefined = isServerBuild ? {
        // Route all React imports to slim-react for SSR.
        react:                slimReactIndex,
        'react/jsx-runtime':  slimReactJsx,
        'react/jsx-dev-runtime': slimReactJsx,
        // @emotion/* is bundled (not external) so that its `react` imports are
        // resolved through the alias above to slim-react. If left external,
        // emotion loads real React from node_modules and calls
        // ReactSharedInternals.H.useContext which requires React's dispatcher.
    } : undefined;

    const externals = isServerBuild ? [
        // Node.js built-ins — must not be bundled; resolved by the runtime.
        'node:fs', 'node:path', 'node:os', 'node:stream', 'node:util',
        // @emotion/server is only used outside component rendering (CSS extraction)
        // and does not call React hooks, so it is safe to leave as external.
        '@emotion/server',
    ] : undefined;

    // reactMode lets the caller force React's dev/prod runtime independently of
    // the webpack build mode. Only applies to the client bundle (SSR uses slim-react).
    // 'development' → process.env.NODE_ENV = "development" + JSX dev transform.
    const effectiveReactDev = isServerBuild
        ? false  // slim-react doesn't use NODE_ENV
        : opts.reactMode === 'development' ? true
        : opts.reactMode === 'production'  ? false
        : isDev;                           // default: follow build mode

    if (!isServerBuild && opts.reactMode !== undefined) {
        // Override the SWC JSX development flag for all js/ts rules already built
        const rules = localConfig.module?.rules ?? [];
        for (const rule of rules) {
            if (!rule?.use || !Array.isArray(rule.use)) continue;
            for (const entry of rule.use) {
                if (entry?.loader?.includes('swc-loader')) {
                    entry.options = entry.options ?? {};
                    entry.options.jsc = entry.options.jsc ?? {};
                    entry.options.jsc.transform = entry.options.jsc.transform ?? {};
                    entry.options.jsc.transform.react = entry.options.jsc.transform.react ?? {};
                    entry.options.jsc.transform.react.development = effectiveReactDev;
                    // refresh stays disabled (see comment above createClientCompiler) regardless of reactMode
                }
            }
        }
    }

    const extraPlugins: any[] = [];

    const defineValues: Record<string, string> = { ...(opts.define ?? {}) };
    // When reactMode overrides the React runtime we must also set process.env.NODE_ENV
    // so React picks its dev/prod bundle, independently of the rspack build mode.
    if (!isServerBuild && opts.reactMode !== undefined) {
        defineValues['process.env.NODE_ENV'] = JSON.stringify(opts.reactMode);
    }
    if (Object.keys(defineValues).length > 0) {
        const DefinePlugin = (rspack as any).DefinePlugin || (rspack as any).plugins?.DefinePlugin;
        if (DefinePlugin) {
            extraPlugins.push(new DefinePlugin(defineValues));
        }
    }

    const resolveConfig: any = {
        extensions: ['.tsx', '.ts', '.js', '.jsx'],
        // Resolve symlinked packages (monorepos, `file:` deps like this repo's
        // own website/ using `hadars: file:..`) against their apparent
        // node_modules path rather than following the symlink to its real
        // location — otherwise the /node_modules/ exclude above never matches
        // for a symlinked dependency, since the resolved real path doesn't
        // contain "node_modules" at all. Confirmed via a real build: without
        // this, the fix above only protects a plain (non-symlinked) npm
        // install, not a symlinked local/workspace one.
        symlinks: false,
        alias: resolveAliases,
        // for server builds prefer the package "main"/"module" fields and avoid "browser" so we don't pick browser-specific entrypoints
        mainFields: isServerBuild ? ['main', 'module'] : ['browser', 'module', 'main'],
        // for server builds exclude the "browser" condition so packages with package.json
        // "exports" conditions (e.g. @emotion/*) resolve their Node/CJS entry, not the browser build
        ...(isServerBuild ? { conditionNames: ['node', 'require', 'default'] } : {}),
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
        // Persist transformed modules to disk — subsequent starts only recompile
        // changed files, making repeat dev starts significantly faster.
        cache: true,
        externals,
        // externalsPresets.node externalises ALL Node.js built-ins (bare names
        // and the node: prefix) for both static and dynamic imports.  This
        // complements the explicit `externals` array: the preset handles the
        // node: URI scheme that rspack cannot resolve as a file, while the
        // array keeps '@emotion/server' as an explicit external.
        ...(isServerBuild ? { externalsPresets: { node: true } } : {}),
        ...(optimization !== undefined ? { optimization } : {}),
        plugins: [
            !isServerBuild && new rspack.HtmlRspackPlugin({
                publicPath: base || '/',
                template: opts.htmlTemplate
                    ? pathMod.resolve(process.cwd(), opts.htmlTemplate)
                    : clientScriptPath,
                scriptLoading: 'module',
                filename: 'out.html',
                inject: 'head',
                minify: opts.mode === 'production',
            }),
            !isServerBuild && {
                apply(compiler: any) {
                    compiler.hooks.emit.tapAsync('HadarsAsyncModuleScript', (compilation: any, cb: () => void) => {
                        const asset = compilation.assets['out.html'];
                        if (asset) {
                            const html: string = asset.source();
                            const updated = html.replace(
                                /(<script\b[^>]*\btype="module"[^>]*)(>)/g,
                                (match, before: string, end: string) =>
                                    before.includes('async') ? match : `${before} async${end}`,
                            );
                            compilation.assets['out.html'] = {
                                source: () => updated,
                                size:   () => Buffer.byteLength(updated),
                            };
                        }
                        cb();
                    });
                },
            },
            false && isDev && !isServerBuild && new ReactRefreshPlugin({ exclude: /node_modules/ }), // disabled — see comment above createClientCompiler
            includeHotPlugin && isDev && !isServerBuild && new rspack.HotModuleReplacementPlugin(),
            ...extraPlugins,
            ...(opts.plugins ?? []),
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
            ignored: ['**/node_modules/**', '**/.hadars/**', '/tmp/**'],
        },
    };
};

/**
 * Creates a configured rspack compiler for the client bundle without running it.
 * Intended for use with RspackDevServer for proper HMR support.
 *
 * HotModuleReplacementPlugin is deliberately NOT applied here. RspackDevServer
 * already applies it itself when `devServer.hot: true` is set — it warns
 * ("hot: true" automatically applies HMR plugin, you don't have to add it
 * manually) if it's also applied here.
 *
 * REACT REFRESH IS CURRENTLY DISABLED (`refresh: false` on the swc transform,
 * `ReactRefreshPlugin` short-circuited to never apply). History, for whoever
 * revisits this:
 *
 *   1. React Refresh's transform emits `$RefreshReg$(...)`/`$RefreshSig$()`
 *      calls into every component. Something has to define those helpers at
 *      runtime, or every component throws a ReferenceError on eval — killing
 *      module.hot setup client-side before the HMR client can ever fetch a
 *      hot-update chunk, even though the server emits them correctly.
 *   2. First problem found: node_modules content (including hadars's own
 *      dist/index.js, unavoidably pulled into every client entry) was also
 *      getting the transform applied, and a hook-named export in it produced
 *      a genuine parse error. Fixed by excluding node_modules from the rule
 *      and from ReactRefreshPlugin. Confirmed clean against that specific
 *      repro (see git history on this file).
 *   3. Against a real, more complex app, the same class of failure
 *      resurfaced in a different shape each time it was investigated:
 *      $RefreshReg$ undefined → $ReactRefreshRuntime$ undefined (import
 *      binding never generated) → $RefreshReg$ undefined again (footer gone
 *      entirely, calls still emitted). Each shape was fixed for the specific
 *      repro it was diagnosed against, but none of those repros reproduced
 *      the real app's failure directly, so each "fix" just moved the gap.
 *   4. Rather than keep shipping fixes verified only against a repro that
 *      isn't actually reproducing the reported failure, the transform is
 *      disabled outright. HotModuleReplacementPlugin (applied by
 *      RspackDevServer itself, see above) still handles general module
 *      hot-swapping — a changed module that isn't accepted by
 *      module.hot.accept() (which React Refresh would normally have wired up
 *      per-component) bubbles up to a full page reload instead, which is
 *      rspack-dev-server's standard fallback behavior. Verified end-to-end
 *      with Playwright: editing a component produces zero page errors and
 *      the browser reloads automatically with the new content — no in-place
 *      Fast Refresh patch, but no frozen/broken page either.
 *   5. Re-enabling proper Fast Refresh needs to be diagnosed against the
 *      actual failing app (or an app that reproduces its specific shape),
 *      not a fresh minimal repro that happens to work — that's the gap that
 *      broke steps 2 and 3.
 *
 * Separately (kept, and still correct regardless of the above):
 * node_modules is excluded from the JS/TS rule and from RelativePlugin's
 * exclude option. resolve.symlinks: false ensures that exclude also covers
 * symlinked (`file:`) dependencies like this repo's own website/, whose
 * resolved real path wouldn't otherwise contain "node_modules" at all.
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
            compiler.watch({ ignored: ['**/node_modules/**', '**/.hadars/**', '/tmp/**'] }, (err: any, stats: any) => {
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
                preset: 'minimal',
            }));

            resolve(stats);
        });
    });
}
