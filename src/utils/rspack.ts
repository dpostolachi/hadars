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
                                            // Emit $RefreshReg$/$RefreshSig$ calls on client dev builds
                                            // only. ReactRefreshPlugin's loader defines those helpers;
                                            // the two must cover exactly the same set of modules — see
                                            // the long comment above createClientCompiler.
                                            refresh: isDev && !isServerBuild,
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
                                            refresh: isDev && !isServerBuild,
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
                    // `refresh` is deliberately NOT set here — the useReactRefresh block
                    // below is the single writer for it, so the transform can never
                    // disagree with ReactRefreshPlugin.
                }
            }
        }
    }

    // SINGLE SOURCE OF TRUTH for React Fast Refresh.
    //
    // The SWC transform emits $RefreshReg$/$RefreshSig$ call sites;
    // ReactRefreshPlugin supplies the definitions (a per-module footer, plus an
    // injected entry that installs global no-op fallbacks for any module the
    // loader missed). If the transform runs and the plugin does NOT, every call
    // site is unbacked and the first component to evaluate throws
    // "ReferenceError: $RefreshReg$ is not defined" — killing the update even
    // though the hot-update chunk arrived correctly.
    //
    // That drift is exactly what happened when the two were gated on different
    // conditions: ReactRefreshPlugin bails out internally on
    //     mode !== 'development' || process.env.NODE_ENV === 'production'
    // (see its apply()), while the SWC flag was derived only from hadars' own
    // isDev. Running `NODE_ENV=production hadars dev` therefore produced a
    // bundle with refresh calls and zero definitions. Reproduced directly:
    // calls 1, defs 0, and no reactRefreshEntry in the bundle.
    //
    // So compute the decision once, replicating the plugin's own bail
    // condition, and drive BOTH the transform and the plugin from it below.
    // Read NODE_ENV indirectly. A direct `process.env.NODE_ENV === 'production'`
    // is constant-folded to `false` by the bundler that builds dist/cli.js, which
    // would silently delete this guard (verified: the compiled output contained
    // `nodeEnvIsProd = false`). Indexing with a computed key defeats that.
    const nodeEnvKey = 'NODE' + '_ENV';
    const nodeEnvIsProd = (globalThis as any).process?.env?.[nodeEnvKey] === 'production';
    const useReactRefresh = isDev
        && !isServerBuild
        && effectiveReactDev
        && !nodeEnvIsProd;

    if (isDev && !isServerBuild && !useReactRefresh) {
        // Refresh is off in a dev client build (forced production React runtime,
        // or NODE_ENV=production). HMR still works — updates that can't be patched
        // in place fall back to a full page reload — but say so, because silently
        // losing Fast Refresh is otherwise very hard to diagnose.
        console.log(
            `[hadars] React Fast Refresh disabled (${nodeEnvIsProd ? 'NODE_ENV=production' : "reactMode: 'production'"}); ` +
            `hot updates will fall back to a full page reload.`,
        );
    }

    // Force the SWC refresh flag on every js/ts rule to match the decision above.
    // getConfigBase() sets a provisional value from isDev alone; it cannot see
    // NODE_ENV or reactMode, so this is what keeps the transform and the plugin
    // from ever disagreeing.
    for (const rule of (localConfig.module?.rules ?? [])) {
        if (!rule?.use || !Array.isArray(rule.use)) continue;
        for (const useEntry of rule.use) {
            if (!useEntry?.loader?.includes('swc-loader')) continue;
            useEntry.options = useEntry.options ?? {};
            useEntry.options.jsc = useEntry.options.jsc ?? {};
            useEntry.options.jsc.transform = useEntry.options.jsc.transform ?? {};
            useEntry.options.jsc.transform.react = useEntry.options.jsc.transform.react ?? {};
            useEntry.options.jsc.transform.react.refresh = useReactRefresh;
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
            useReactRefresh && new ReactRefreshPlugin({
                exclude: /node_modules/,
                // Match the SWC transform's coverage exactly. The plugin's default
                // `include` is end-anchored (/\.([cm]js|[jt]sx?|flow)$/i) and is tested
                // against the full request including any ?query, so a module imported
                // with a cache-busting suffix would get $RefreshReg$ calls from SWC but
                // no helper definitions from this loader. hadars no longer appends such a
                // suffix (see getSuffix in build.ts), and this pattern tolerates one
                // anyway so the two can never silently drift apart again.
                include: /\.([cm]js|[jt]sx?|flow)(\?.*)?$/i,
            }),
            includeHotPlugin && isDev && !isServerBuild && new rspack.HotModuleReplacementPlugin(),
            // Drop no-op hot updates.
            //
            // A compilation that recompiles the client without changing any of its
            // modules still emits an update whose chunk carries an EMPTY module map
            // and whose only effect is reassigning __webpack_require__.h to the new
            // hash. The client applies it, advances its hash, and is then one step
            // AHEAD of the chunk the next real edit produces — so that edit requests
            // a filename that only exists one cycle later, 404s, and the update chain
            // stalls permanently. Observed when a rebuild races the SSR watcher
            // during startup, which seeds the lead before the first user edit.
            //
            // The test is the chunk's module map, NOT the manifest: a healthy update
            // also has {"c":["main"],"r":[],"m":[]} ("m" lists REMOVED modules), so
            // keying off the manifest deletes real updates and breaks Fast Refresh.
            // Verified: a working App.tsx patch and a no-op update have identical
            // manifests and differ only in the chunk (5460 bytes with the module vs.
            // ~225 bytes with `{}`).
            isDev && !isServerBuild && {
                apply(compiler: any) {
                    compiler.hooks.compilation.tap('HadarsDropEmptyHotUpdate', (compilation: any) => {
                        compilation.hooks.processAssets.tap(
                            { name: 'HadarsDropEmptyHotUpdate', stage: 4000 },
                            (assets: Record<string, any>) => {
                                for (const name of Object.keys(assets)) {
                                    if (!name.endsWith('.hot-update.js')) continue;
                                    let src: string;
                                    try {
                                        src = assets[name].source().toString();
                                    } catch {
                                        continue;
                                    }
                                    // The chunk calls webpackHotUpdate<name>("main", {<modules>}, ...).
                                    // An empty `{}` in that position means no module changed.
                                    if (!/webpackHotUpdate[^(]*\(\s*("[^"]*"|'[^']*')\s*,\s*\{\s*\}/.test(src)) continue;
                                    const base = name.slice(0, -'.js'.length);
                                    delete assets[name];
                                    for (const asset of Object.keys(assets)) {
                                        if (asset === `${base}.json`) delete assets[asset];
                                    }
                                }
                            },
                        );
                    });
                },
            },
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
 * REACT FAST REFRESH IS ENABLED for client dev builds. The invariant that makes
 * it work — and that broke it three times before — is that the SWC `refresh`
 * transform and ReactRefreshPlugin's helper-injecting loader must cover EXACTLY
 * the same set of modules. The transform emits `$RefreshReg$(...)`/`$RefreshSig$()`
 * calls; the loader appends the footer that defines those helpers. Any module
 * that gets one without the other throws `$RefreshReg$ is not defined` on eval,
 * which kills the HMR client's bootstrap before it can apply a single update.
 *
 * Two things maintain that invariant here:
 *
 *   1. node_modules is excluded from BOTH (the JS/TS rule's `exclude` and the
 *      plugin's `exclude`). Pre-bundled vendor code — which necessarily includes
 *      hadars's own dist/index.js, pulled into every client entry — must not be
 *      transformed at all.
 *   2. The plugin's `include` is widened to tolerate a `?query` suffix. The
 *      default (`/\.([cm]js|[jt]sx?|flow)$/i`) is END-ANCHORED and is tested
 *      against the full request, while the SWC rule's `test` matches the
 *      resource path with the query stripped. That asymmetry was the actual root
 *      cause of the long-standing failure: the dev client entry imported the
 *      user's app module as `<entry>.tsx?v=<timestamp>`, so the app module — the
 *      one file the developer actually edits — got refresh calls from SWC but no
 *      helper definitions from the loader. It never reproduced in a minimal
 *      single-file repro because the suffix was only ever applied to the user
 *      entry. The suffix itself has since been removed (see getSuffix in
 *      build.ts); this pattern keeps the two rules from silently drifting apart
 *      again.
 *
 * Fast Refresh also requires the React root to SURVIVE hot updates — see the
 * dev path in utils/clientScript.tsx, which caches the root on globalThis and
 * calls module.hot.accept() on the app entry. Without that accept handler the
 * update propagates past the entry with nowhere to stop and the dev server
 * falls back to a full page reload.
 *
 * Verified end-to-end in test/hmr.e2e.test.ts: editing a component updates the
 * DOM with zero page errors, without reloading the document, and with useState
 * preserved.
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
