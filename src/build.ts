import { createProxyHandler } from "./utils/proxyHandler";
import { parseRequest } from "./utils/request";
import { upgradeHandler } from "./utils/upgradeRequest";
import { getReactResponse } from "./utils/response";
import { createClientCompiler, compileEntry, dropPhantomRemovals } from "./utils/rspack";
import { serve, nodeReadableToWebStream } from "./utils/serve";
import { tryServeFile, tryServeFileCached } from "./utils/staticFile";
import { isBun, isDeno, isNode } from "./utils/runtime";
import { RspackDevServer } from "@rspack/dev-server";
import pathMod from "node:path";
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import cluster from 'node:cluster';
import { checkLiveLock, isPidAlive, writeLock, updateLock, lockPath } from './utils/lock';
import type { HadarsEntryModule, HadarsOptions, HadarsProps } from "./types/hadars";
import {
    buildSsrResponse, makePrecontentHtmlGetter,
    type CacheFetchHandler, createRenderCache,
} from './utils/ssrHandler';
import { runSources } from './source/runner';
import { buildSchemaExecutor } from './source/inference';
import { createGraphiqlHandler, GRAPHQL_PATH } from './source/graphiql';

/**
 * Reads an HTML template, processes any `<style>` blocks through PostCSS
 * (using the project's postcss.config.js), writes the result to a temp file,
 * and returns the temp file path. If there are no `<style>` blocks the
 * original path is returned unchanged.
 */
async function processHtmlTemplate(templatePath: string): Promise<string> {
    const html = await fs.readFile(templatePath, 'utf-8');

    const styleRegex = /<style([^>]*)>([\s\S]*?)<\/style>/gi;
    const matches: Array<{ full: string; attrs: string; css: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = styleRegex.exec(html)) !== null) {
        matches.push({ full: m[0]!, attrs: m[1] ?? '', css: m[2] ?? '' });
    }
    if (matches.length === 0) return templatePath;

    await ensureHadarsTmpDir();

    // Cache by content hash — same template content → skip Tailwind re-scan on restart.
    const sourceHash = crypto.createHash('md5').update(html).digest('hex').slice(0, 8);
    const cachedPath = pathMod.join(HADARS_TMP_DIR, `template-${sourceHash}.html`);
    try {
        await fs.access(cachedPath);
        return cachedPath; // cache hit
    } catch { /* cache miss — process below */ }

    const { default: postcss } = await import('postcss');
    let plugins: any[] = [];
    try {
        const { default: loadConfig } = await import('postcss-load-config' as any);
        const config = await loadConfig({}, process.cwd());
        plugins = (config as any).plugins ?? [];
    } catch {
        // No postcss config found — process without plugins (passthrough)
    }

    let processedHtml = html;
    for (const { full, attrs, css } of matches) {
        try {
            const result = await postcss(plugins).process(css, { from: templatePath });
            processedHtml = processedHtml.replace(full, `<style${attrs}>${result.css}</style>`);
        } catch (err) {
            console.warn('[hadars] PostCSS error processing <style> block in HTML template:', err);
        }
    }

    await fs.writeFile(cachedPath, processedHtml);
    return cachedPath;
}

// Round-robin thread pool for SSR rendering — used on Bun/Deno where
// node:cluster is not available but node:worker_threads is.

import type { SerializableRequest } from './ssr-render-worker';

type PendingRenderFull = {
    kind: 'renderFull';
    resolve: (result: { html: string; headHtml: string; status: number }) => void;
    reject: (err: Error) => void;
};
type PendingEntry = PendingRenderFull;

class RenderWorkerPool {
    private workers: any[] = [];
    private pending = new Map<number, PendingEntry>();
    // Track which pending IDs were dispatched to each worker so we can reject
    // them when that worker crashes.
    private workerPending = new Map<any, Set<number>>();
    private nextId = 0;
    private rrIndex = 0;
    private _Worker: any = null;
    private _workerPath = '';
    private _ssrBundlePath = '';

    constructor(workerPath: string, size: number, ssrBundlePath: string) {
        // Dynamically import Worker so this class can be defined at module load
        // time without a top-level await.
        this._init(workerPath, size, ssrBundlePath);
    }

    private _init(workerPath: string, size: number, ssrBundlePath: string) {
        this._workerPath = workerPath;
        this._ssrBundlePath = ssrBundlePath;
        import('node:worker_threads').then(({ Worker }) => {
            this._Worker = Worker;
            for (let i = 0; i < size; i++) this._spawnWorker();
        }).catch(err => {
            console.error('[hadars] Failed to initialise render worker pool:', err);
        });
    }

    private _spawnWorker() {
        if (!this._Worker) return;
        const w = new this._Worker(this._workerPath, { workerData: { ssrBundlePath: this._ssrBundlePath } });
        this.workerPending.set(w, new Set());
        w.on('message', (msg: any) => {
            const { id, html, headHtml, status, error, stack } = msg;
            const p = this.pending.get(id);
            if (!p) return;
            this.pending.delete(id);
            this.workerPending.get(w)?.delete(id);
            if (error) {
                const e = new Error(error);
                if (stack) e.stack = stack;
                p.reject(e);
            } else p.resolve({ html, headHtml, status });
        });
        w.on('error', (err: Error) => {
            console.error('[hadars] Render worker error:', err);
            this._handleWorkerDeath(w, err);
        });
        w.on('exit', (code: number) => {
            if (code !== 0) {
                console.error(`[hadars] Render worker exited with code ${code}`);
                this._handleWorkerDeath(w, new Error(`Render worker exited with code ${code}`));
            }
        });
        this.workers.push(w);
    }

    private _handleWorkerDeath(w: any, err: Error) {
        const idx = this.workers.indexOf(w);
        if (idx !== -1) this.workers.splice(idx, 1);

        const ids = this.workerPending.get(w);
        if (ids) {
            for (const id of ids) {
                const p = this.pending.get(id);
                if (p) {
                    this.pending.delete(id);
                    p.reject(err);
                }
            }
            this.workerPending.delete(w);
        }

        // Spawn a replacement to keep the pool at full capacity.
        console.log('[hadars] Spawning replacement render worker');
        this._spawnWorker();
    }

    private nextWorker(): any | undefined {
        if (this.workers.length === 0) return undefined;
        const w = this.workers[this.rrIndex % this.workers.length];
        this.rrIndex++;
        return w;
    }

    /** Run the full SSR lifecycle in a worker thread. Returns html, headHtml, status. */
    renderFull(req: SerializableRequest): Promise<{ html: string; headHtml: string; status: number }> {
        return new Promise((resolve, reject) => {
            const w = this.nextWorker();
            if (!w) { reject(new Error('[hadars] No render workers available')); return; }
            const id = this.nextId++;
            this.pending.set(id, { kind: 'renderFull', resolve, reject });
            this.workerPending.get(w)?.add(id);
            try {
                w.postMessage({ id, type: 'renderFull', streaming: false, request: req });
            } catch (err) {
                this.pending.delete(id);
                this.workerPending.get(w)?.delete(id);
                reject(err);
            }
        });
    }

    async terminate(): Promise<void> {
        await Promise.all(this.workers.map((w: any) => w.terminate()));
    }
}

/** Serialize a HadarsRequest into a structure-clonable object for postMessage. */
async function serializeRequest(req: any): Promise<SerializableRequest> {
    const isGetOrHead = ['GET', 'HEAD'].includes(req.method ?? 'GET');
    let body: Uint8Array | null = null;
    if (!isGetOrHead) {
        try {
            body = new Uint8Array(await req.arrayBuffer());
        } catch {
            // Body already consumed upstream (e.g. by options.fetch returning undefined
            // after reading the body). Proceed without body — SSR does not need it.
        }
    }
    const headers: Record<string, string> = {};
    (req.headers as Headers).forEach((v: string, k: string) => { headers[k] = v; });
    return {
        url: req.url,
        method: req.method ?? 'GET',
        headers,
        body,
        pathname: req.pathname,
        search: req.search,
        location: req.location,
        cookies: req.cookies,
    };
}

interface HadarsRuntimeOptions extends HadarsOptions {
    mode: "development" | "production";
}

const SSR_FILENAME = 'index.ssr.js';
const __dirname = process.cwd();

type Mode = "development" | "production";

// The client entry imports the user's app module by absolute path. In dev this
// used to get a `?v=<timestamp>` cache-buster appended, which silently broke
// React Fast Refresh: @rspack/plugin-react-refresh matches its runtime-injecting
// loader with `include: /\.([cm]js|[jt]sx?|flow)$/i` — an END-ANCHORED regex —
// against the full request. "App.tsx?v=123" does not end in ".tsx", so the
// refresh loader was skipped for the app module, while the SWC transform (which
// matches on the resource path, query stripped) still injected $RefreshReg$ /
// $RefreshSig$ calls into it. Result: the helpers were never defined for exactly
// the one module the user edits, so every component threw "$RefreshReg$ is not
// defined". That is why this only ever reproduced against real apps and not a
// minimal repro — the suffix is applied to the user entry specifically.
//
// The suffix is also unnecessary: rspack invalidates changed modules through its
// own watcher and content hashing, not through import-URL cache busting.
const getSuffix = (_mode: Mode) => '';

export const HadarsFolder = './.hadars';
const StaticPath = `${HadarsFolder}/static`;
// Per-build copies of the compiled SSR bundle, used to force a genuinely
// fresh dynamic import() on every rebuild — see the comment at the import
// site for why a `?query` cache-buster on the same path isn't sufficient.
const SsrImportDir = `${HadarsFolder}/.ssr-modules`;
// Dedicated temp directory — keeps all hadars temp files out of the root of
// os.tmpdir() so rspack's file watcher doesn't traverse unrelated system files
// (e.g. Steam/Chrome shared-memory device files) in that directory.
const HADARS_TMP_DIR = pathMod.join(os.tmpdir(), 'hadars');
const ensureHadarsTmpDir = () => fs.mkdir(HADARS_TMP_DIR, { recursive: true });

const readReactMajor = async (): Promise<number> => {
    let dir = process.cwd();
    while (true) {
        try {
            const pkgPath = pathMod.join(dir, 'node_modules', 'react', 'package.json');
            const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
            return parseInt((pkg.version as string).split('.')[0]!, 10);
        } catch {}
        const parent = pathMod.dirname(dir);
        if (parent === dir) return 19; // reached filesystem root without finding React
        dir = parent;
    }
};

const validateOptions = (options: HadarsRuntimeOptions) => {
    if (!options.entry) {
        throw new Error("Entry file is required");
    }
    if (options.mode !== 'development' && options.mode !== 'production') {
        throw new Error("Mode must be either 'development' or 'production'");
    }
};

/**
 * Resolves the SSR worker script and the command used to run it.
 *
 * Four modes:
 *  1. Bun (source)     — `bun ssr-watch.ts`
 *  2. Deno (source)    — `deno run --allow-all ssr-watch.ts`
 *  3. Node.js (source) — tsx/ts-node detected via execArgv; used when the
 *                        caller itself was launched by a TS runner (e.g. `npx tsx cli.ts dev`)
 *  4. Node.js (compiled) — `node ssr-watch.js` (post `npm run build:cli`)
 */
const resolveWorkerCmd = (packageDir: string): string[] => {
    const tsPath = pathMod.resolve(packageDir, 'ssr-watch.ts');
    const jsPath = pathMod.resolve(packageDir, 'ssr-watch.js');

    if (isBun && existsSync(tsPath)) {
        return ['bun', tsPath];
    }

    if (isDeno && existsSync(tsPath)) {
        return ['deno', 'run', '--allow-all', tsPath];
    }

    // Detect if the current process was launched by a Node.js TypeScript runner
    // (tsx, ts-node). Modern tsx injects itself via --import into execArgv;
    // older versions appear in argv[1]. ts-node works similarly.
    if (existsSync(tsPath)) {
        const allArgs = [...process.execArgv, process.argv[1] ?? ''];
        const hasTsx = allArgs.some(a => a.includes('tsx'));
        const hasTsNode = allArgs.some(a => a.includes('ts-node'));
        if (hasTsx) return ['tsx', tsPath];
        if (hasTsNode) return ['ts-node', tsPath];
    }

    if (existsSync(jsPath)) {
        return ['node', jsPath];
    }

    throw new Error(
        `[hadars] SSR worker not found. Expected:\n` +
        `  ${jsPath}\n` +
        `Run "npm run build:cli" to compile it, or launch hadars via a TypeScript runner:\n` +
        `  npx tsx cli.ts dev`
    );
};

export const dev = async (options: HadarsRuntimeOptions) => {

    validateOptions(options);

    const liveLock = await checkLiveLock(HadarsFolder);
    if (liveLock) {
        console.error(
            `[hadars] Another hadars process (pid ${liveLock.pid}${liveLock.childPid ? `, worker pid ${liveLock.childPid}` : ''}) ` +
            `is already running against ${HadarsFolder}/. Run \`hadars stop\` first, or verify with \`lsof -i :${liveLock.port}\`.`
        );
        process.exit(1);
    }

    // clean .hadars
    await fs.rm(HadarsFolder, { recursive: true, force: true });
    await fs.mkdir(SsrImportDir, { recursive: true });

    let { port = 9090, baseURL: configuredBaseURL = '' } = options;
    // dev always serves from the root path — a prod baseURL doesn't resolve
    // against localhost, and this must hold even when Hadars.dev() is called
    // directly (not just through the CLI wrapper that used to do this).
    const baseURL = '';
    if (configuredBaseURL) {
        console.log(`[hadars] Ignoring baseURL "${configuredBaseURL}" in dev mode — dev always serves from the root path.`);
    }

    console.log(`Starting Hadars on port ${port}`);

    await writeLock(HadarsFolder, { pid: process.pid, port, startedAt: Date.now() });
    const handleProxy = createProxyHandler(options);
    const handleWS = upgradeHandler(options);
    const handler = options.fetch;

    // Run source plugins and set up GraphiQL if config.sources is present.
    let handleGraphiql: ((req: Request) => Promise<Response | undefined>) | null = null;
    let devStaticCtx: { graphql: import('./types/hadars').GraphQLExecutor } | undefined;
    if (options.sources && options.sources.length > 0) {
        console.log(`[hadars] Running ${options.sources.length} source plugin(s)…`);
        try {
            const store = await runSources(options.sources);
            const executor = await buildSchemaExecutor(store);
            if (executor) {
                devStaticCtx = { graphql: executor };
                handleGraphiql = createGraphiqlHandler(executor);
                console.log(`[hadars] GraphiQL available at http://localhost:${port}${GRAPHQL_PATH}`);
            } else {
                console.warn('[hadars] `graphql` package not found — GraphiQL disabled. Run: npm install graphql');
            }
        } catch (err) {
            console.error('[hadars] Source plugin error:', err);
        }
    }

    const entry = pathMod.resolve(__dirname, options.entry);
    const hmrPort = options.hmrPort ?? port + 1;

    // prepare client script once (we will compile into StaticPath)
    const packageDir = pathMod.dirname(fileURLToPath(import.meta.url));
    const clientScriptPath = pathMod.resolve(packageDir, 'utils', 'clientScript.tsx');

    let clientScript = '';
    try {
        clientScript = (await fs.readFile(clientScriptPath, 'utf-8'))
            .replace('$_MOD_PATH$', entry + getSuffix(options.mode));
    }
    catch (err) {
        console.error("Failed to read client script from package dist, falling back to src", err);
        throw err;
    }

    await ensureHadarsTmpDir();
    const tmpFilePath = pathMod.join(HADARS_TMP_DIR, `client-${Date.now()}.tsx`);
    await fs.writeFile(tmpFilePath, clientScript);

    // SSR live-reload id to force re-import
    let ssrBuildId = crypto.randomBytes(4).toString('hex');

    // Cached SSR module — re-resolved only when ssrBuildId rotates after a rebuild.
    // Avoids a dynamic import() cache lookup on every request.
    let cachedSsrModule: HadarsEntryModule<any> | null = null;
    let cachedSsrBuildId = '';
    // Path of the last per-build SSR module copy, so it can be cleaned up once
    // the next one is imported (see the import site below).
    let previousSsrImportPath: string | null = null;

    // Pre-process the HTML template's <style> blocks through PostCSS (e.g. Tailwind).
    const resolvedHtmlTemplate = options.htmlTemplate
        ? await processHtmlTemplate(pathMod.resolve(__dirname, options.htmlTemplate))
        : undefined;

    // Start rspack-dev-server for the client bundle. It provides true React
    // Fast Refresh HMR: the browser's HMR runtime connects directly to the
    // dev server's WebSocket on hmrPort and receives module-level patches
    // without full page reloads. writeToDisk lets the server serve the
    // initial index.js and out.html from disk.
    const clientCompiler = createClientCompiler(tmpFilePath, {
        target: 'web',
        output: {
            filename: "index.js",
            path: pathMod.resolve(__dirname, StaticPath),
            // Absolute publicPath pointing at the dev server, NOT the app server.
            //
            // Without this, output.publicPath is unset and the HMR runtime derives
            // hot-update URLs from where index.js was loaded — the app server on
            // `port`. The app server has no knowledge of hot updates; it only serves
            // .hadars/static/ from disk (see the static fallback in the request
            // handler), so an update resolves only if devMiddleware's writeToDisk
            // has already flushed that chunk. When the browser wins that race the
            // request 404s, and because a failed update leaves the client's hash
            // stale, every subsequent edit asks for a hash the compiler has moved
            // past — the update chain never recovers without a manual refresh.
            //
            // RspackDevServer serves hot-update chunks from memory on hmrPort, so
            // pointing at it removes the disk round-trip and the race with it.
            publicPath: `http://localhost:${hmrPort}/`,
        },
        base: baseURL,
        mode: 'development',
        swcPlugins: options.swcPlugins,
        define: options.define,
        moduleRules: options.moduleRules,
        plugins: options.plugins,
        postcssPlugins: options.postcssPlugins,
        reactMode: options.reactMode,
        htmlTemplate: resolvedHtmlTemplate,
    });

    // Drop "phantom removals" — files the watcher reports as removed that are
    // still on disk — before rspack acts on them.
    //
    // Why this is safe: a removal is a past-tense claim about a file's existence,
    // and it is directly checkable. If the file is there, the claim is false, and
    // recompiling on it is work done for no change. This is unlike a modification,
    // where a stale timestamp may still accompany real content change, so the
    // guard deliberately touches `removedFiles` only. A delete-then-recreate
    // inside one tick loses nothing either: the recreate raises its own event.
    //
    // Why it matters: every spurious compilation advances the client hash, and a
    // browser connecting between that compilation and the next holds a hash whose
    // update chunk has not been emitted yet.
    //
    // Do NOT read this as "phantom removals break HMR". They were investigated at
    // length as the suspected cause of a reported stall and were not it — the
    // actual cause was an app-side window.fetch override (see the note on the
    // hash instrumentation below). This guard stands on its own much smaller
    // merit: recompiling because a file that still exists was reported removed is
    // wasted work, and wasted work here is not free.
    //
    // Seen in the wild with @swc/plugin-relay, which emits non-normalised import
    // paths (`src/components/./__generated__/X.ts`). rspack records the dependency
    // under one path shape, re-resolves it under another, and reports 27 present
    // files as removed.
    //
    // KNOWN LIMIT — this does NOT prevent the compilation. `watchRun` fires after
    // the watcher has already decided to rebuild, so clearing `removedFiles` here
    // stops the phantoms propagating into the compilation's own bookkeeping but
    // arrives too late to cancel it. Verified against the reporting project: the
    // guard fires, and a second compilation still happens. Preventing the rebuild
    // needs the paths normalised before the watcher records them, which is a
    // resolution-level change and deliberately out of scope here.
    //
    // The predicate lives in utils/rspack.ts so it can be tested directly —
    // see test/phantom-removal.test.ts.
    //
    // Populated here so the HADARS_DEBUG_HMR detector can still report what was
    // dropped: this hook runs first and would otherwise silence it.
    let droppedPhantomRemovals: string[] = [];
    (clientCompiler as any).hooks.watchRun?.tapAsync?.('hadars-drop-phantom-removals', (c: any, cb: any) => {
        try {
            droppedPhantomRemovals = dropPhantomRemovals(c?.removedFiles, existsSync);
        } catch { droppedPhantomRemovals = []; /* never let this break a build */ }
        cb();
    });

    const devServer = new RspackDevServer({
        port: hmrPort,
        hot: true,
        // React Fast Refresh applies .tsx component updates in place — see the
        // comment above createClientCompiler in utils/rspack.ts for the loader/
        // transform coverage invariant that makes it work. liveReload is left
        // enabled (the default) as a safety net for changes Fast Refresh legitimately
        // can't patch in place (e.g. edits to a non-component module with no accept
        // handler), so those still reach the browser instead of leaving the page on
        // stale content.
        client: {
            webSocketURL: `ws://localhost:${hmrPort}/ws`,
        },
        devMiddleware: {
            writeToDisk: true,
        },
        headers: { 'Access-Control-Allow-Origin': '*' },
        allowedHosts: 'all',
    }, clientCompiler as any);

    console.log(`Starting HMR dev server on port ${hmrPort}`);

    // Report, at each WebSocket connect, the hash the client is about to be handed
    // and whether it can actually act on it.
    //
    // RspackDevServer sends every newly-connected client the LATEST stats hash. The
    // update chunk a client needs is named for the hash it currently holds, and that
    // chunk is produced by the NEXT compilation. So a client that connects on hash N
    // can only ever apply an update once some later compilation emits main.N... If
    // nothing more compiles, its first edit requests a file that does not exist,
    // 404s, and the update chain stalls with no recovery short of a reload.
    //
    // This is not startup-scoped: it happens at any connect whose hash never gets a
    // chunk emitted for it. `prev-emitted-ok` cannot see this, because it compares
    // compilation N against N-1's emission — the compiler's own consistency — not
    // what a connecting client can resolve.
    if ((globalThis as any).process?.env?.HADARS_DEBUG_HMR) {
        // Tapped inside the gate: `latestClientHash` is only ever read by the
        // reporter below, so tapping `done` unconditionally would run a hook on
        // every compilation to feed code that never executes.
        let latestClientHash: string | undefined;
        (clientCompiler as any).hooks.done.tap('hadars-track-hash', (stats: any) => {
            try { latestClientHash = stats.hash; } catch { /* ignore */ }
        });

        const staticDir = pathMod.resolve(__dirname, StaticPath);
        const reportConnect = async () => {
            const hash = latestClientHash;
            if (!hash) return;
            const needed = `main.${hash}.hot-update.json`;
            let exists = false;
            try {
                await fs.access(pathMod.join(staticDir, needed));
                exists = true;
            } catch { /* not written */ }
            console.log(
                `[hadars:hmr] client connected at hash=${hash} ` +
                `needs=${needed} exists-now=${exists} ` +
                (exists
                    ? '(resolvable)'
                    : '(NOT yet written — normal only if another compilation follows; ' +
                      'if the next edit 404s on this filename, this connect is the stall point)'),
            );
        };
        // devServer.webSocketServer only exists once start() has run, so poll briefly
        // for it rather than tapping before it is constructed.
        (async () => {
            for (let i = 0; i < 100; i++) {
                const impl = (devServer as any).webSocketServer?.implementation;
                if (impl?.on) {
                    impl.on('connection', reportConnect);
                    return;
                }
                await new Promise(r => setTimeout(r, 100));
            }
        })();
    }

    // --- HMR hash instrumentation (opt-in: HADARS_DEBUG_HMR=1) ------------
    //
    // BEFORE READING ANY OF THIS: if hot updates silently stop applying, check
    // whether the APP has replaced window.fetch. That is the most common cause
    // and none of the instrumentation below will point at it.
    //
    // The HMR runtime fetches its update chunks. An app that wraps window.fetch
    // — bot detection, request mocking, an analytics interceptor — can make every
    // update fail while the compiler, the websocket and the chunks on disk are
    // all perfectly healthy. The tell is that the same URL succeeds over XHR and
    // fails over fetch:
    //
    //   await fetch(url)                          -> rejects
    //   new XMLHttpRequest().open('GET', url)     -> 200
    //
    // That signature cost a long investigation across many releases here, and
    // every diagnostic below reported "healthy" throughout, because the compiler
    // side genuinely was. The instrumentation is still useful for real compiler
    // faults — it just cannot see a client that refuses to make the request.
    //
    // Logs, per client compilation, the hash the compiler reports alongside the
    // hot-update filenames it emitted. An update is named for the hash it
    // transitions FROM, so a healthy sequence looks like:
    //   hash=A emitted-updates=[]                      expects-next=main.A...
    //   hash=B emitted-updates=[main.A.hot-update.js]  expects-next=main.B...
    // If the browser keeps asking for a hash that is never emitted, this shows
    // whether the compiler advanced at all.
    let lastHash: string | undefined;
    if ((globalThis as any).process?.env?.HADARS_DEBUG_HMR) {
        (clientCompiler as any).hooks.done.tap('hadars-debug-hmr', (stats: any) => {
          // Guarded for the same reason as the hook above — a debug aid must never
          // be able to take down HMR.
          try {
            const json = stats.toJson({ all: false, hash: true, assets: true });
            const updates = (json.assets ?? [])
                .map((a: any) => a?.name)
                .filter((n: any) => typeof n === 'string' && n.includes('hot-update'));
            // An update chunk is named for the hash it transitions FROM, so in a
            // HEALTHY sequence each compilation emits chunks named for the
            // PREVIOUS compilation's hash:
            //   hash=A emitted=[]                    <- first build
            //   hash=B emitted=[main.A.hot-update.js]
            //   hash=C emitted=[main.B.hot-update.js]
            // That one-cycle offset is the protocol working, NOT an error — the
            // client holds hash A and asks for main.A.hot-update.json to move to B.
            // Do not "fix" the offset; it would break update application.
            //
            // The real failure signal is `prev-emitted-ok=false`: the chunk the
            // client is about to request was not among the files this compilation
            // wrote, which is when a request 404s.
            const prevExpected = lastHash ? `main.${lastHash}.hot-update.json` : null;
            const prevEmittedOk = prevExpected ? updates.includes(prevExpected) : true;
            console.log(
                `[hadars:hmr] compilation hash=${json.hash} ` +
                `emitted-updates=[${updates.join(', ')}] ` +
                `client-will-request=${prevExpected ?? '(none yet)'} ` +
                `prev-emitted-ok=${prevEmittedOk}` +
                (prevEmittedOk ? '' : '  <-- MISMATCH: that chunk was not written; the request will 404'),
            );
            lastHash = json.hash;
          } catch (e) {
            console.log('[hadars:hmr] instrumentation error (ignored):', e);
          }
        });
    }

    // Warn when the client compiler rebuilds before the first page load.
    //
    // Each completed compilation broadcasts a "hash" frame. A browser that
    // connects after N startup compilations has seen N hashes and holds the
    // latest, while the update chunk it needs is named for an earlier one — so it
    // requests a chunk that was never written and the update chain stalls from the
    // very first edit. A single startup compilation cannot exhibit this; two or
    // more can, which is why it reproduces in large apps and not in small ones.
    //
    // Something is invalidating the build before serving begins: commonly a file
    // written into a watched directory during startup (a generated file, a copied
    // asset, an editor artifact) or a `public/` directory that RspackDevServer
    // watches by default.
    if ((globalThis as any).process?.env?.HADARS_DEBUG_HMR) {
        let startupCompilations = 0;
        let pageServed = false;
        // Record which files rspack saw as changed for each rebuild, so the
        // startup warning can name the culprit instead of describing it.
        let lastChangedFiles: string[] = [];
        (clientCompiler as any).hooks.invalid?.tap?.('hadars-startup-invalid', (fileName: string) => {
            if (fileName) lastChangedFiles.push(String(fileName));
        });
        // Report phantom removals the guard dropped. These are files the watcher
        // claimed were removed while they were still on disk; left in place they
        // cost a compilation for no change, and every spurious compilation
        // advances the client hash past the chunk a connecting browser needs.
        //
        // The guard above already removed them, so this is now informational:
        // it tells you the condition is present in your project and points at
        // the transform responsible. Kept because the underlying cause is worth
        // fixing at the source even though hadars no longer acts on it.
        (clientCompiler as any).hooks.watchRun?.tapAsync?.('hadars-phantom-removal', (_c: any, cb: any) => {
            try {
                // Read what the guard recorded rather than re-deriving it: by this
                // point `removedFiles` no longer contains the phantoms.
                const phantom = droppedPhantomRemovals;
                if (phantom.length) {
                    console.warn(
                        `[hadars:hmr] PHANTOM REMOVAL: ${phantom.length} file(s) were reported ` +
                        `as removed by the watcher but are still on disk. They were dropped from ` +
                        `this compilation's records, but the rebuild they triggered still ran — ` +
                        `each one advances the client hash and can stall HMR on the next edit.\n` +
                        `[hadars:hmr]   first: ${phantom[0]}\n` +
                        `[hadars:hmr]   a '/./' segment in that path means a transform emitted ` +
                        `a non-normalised import path; suspect an SWC plugin over generated ` +
                        `files (seen with @swc/plugin-relay over Relay artifacts). Fixing that ` +
                        `at the source is what stops the spurious rebuild.`,
                    );
                }
            } catch { /* diagnostics must never break the build */ }
            cb();
        });
        (clientCompiler as any).hooks.done.tap('hadars-startup-recompile', () => {
            if (pageServed) {
                // A recompile AFTER the page was served is just as damaging as one
                // before it, and the original guard returned early here — so the
                // reported failure produced no warning at all. Any client already
                // connected is holding the previous hash; this compilation emits the
                // chunk for that hash, which is fine. But a client connecting from
                // now on is handed THIS hash, whose chunk will not exist until
                // something compiles again.
                console.warn(
                    `[hadars:hmr] NOTE: client compiler recompiled after the page was ` +
                    `served. Any browser loading from now on is handed this new hash, ` +
                    `whose update chunk does not exist yet — its first edit will 404 ` +
                    `unless another compilation follows.` +
                    (lastChangedFiles.length
                        ? `\n[hadars:hmr] rspack reported these files changed: ${lastChangedFiles.join(', ')}`
                        : `\n[hadars:hmr] rspack did not report a changed file — likely a ` +
                          `directory timestamp or an empty rebuild.`),
                );
                lastChangedFiles = [];
                return;
            }
            startupCompilations += 1;
            if (startupCompilations > 1) {
                console.warn(
                    `[hadars:hmr] WARNING: client compiler has completed ` +
                    `${startupCompilations} compilations before the first page load. ` +
                    `The browser will connect holding the newest hash while the update ` +
                    `it needs is named for an older one, so the first edit can 404 and ` +
                    `stall HMR. Something is retriggering the build during startup — ` +
                    `check for files written into a watched directory (or a public/ dir).` +
                    (lastChangedFiles.length
                        ? `\n[hadars:hmr] rspack reported these files changed: ${lastChangedFiles.join(', ')}`
                        : `\n[hadars:hmr] rspack did not report a changed file — the rebuild may have been ` +
                          `triggered by a directory timestamp rather than a specific file.`),
                );
                lastChangedFiles = [];
            }
        });
        (globalThis as any).__hadarsMarkPageServed = () => { pageServed = true; };
    }

    // Kick off client build — does NOT await here so SSR worker can start in parallel.
    let clientResolved = false;
    const clientBuildDone = new Promise<void>((resolve, reject) => {
        (clientCompiler as any).hooks.done.tap('initial-build', (stats: any) => {
            // Everything in here is wrapped: an exception thrown from a `done` hook
            // propagates into webpack-dev-middleware's own done handling and aborts
            // it, which silently stops the "hash"/"ok" WebSocket frames the HMR
            // client depends on. The browser then holds its load-time hash forever,
            // never requests an update, and the page freezes on stale content with
            // no error shown — the compiler keeps reporting successful rebuilds.
            //
            // stats.toString() is the realistic thrower here: it walks the whole
            // module graph, so it is far likelier to fail on a large real app than
            // on a small one, which is exactly the shape of failure this had.
            // Verified by forcing it to throw: unguarded, HMR dies with no hash
            // frame ever sent; guarded, updates apply normally.
            try {
                if (!clientResolved) {
                    console.log(stats.toString({ colors: true }));
                }
            } catch (e) {
                console.error('[hadars] Failed to print client build stats:', e);
            } finally {
                if (!clientResolved) {
                    clientResolved = true;
                    resolve();
                }
            }
        });
        devServer.start().catch(reject);
    });

    // Start SSR watcher in a separate process to avoid creating two rspack
    // compiler instances in the same process. We use node:child_process.spawn
    // which works on Bun, Node.js, and Deno (via compatibility layer).
    // Spawned immediately so it compiles in parallel with the client build above.
    const workerCmd = resolveWorkerCmd(packageDir);
    console.log('Spawning SSR worker:', workerCmd.join(' '), 'entry:', entry);

    const reactMajor = await readReactMajor();
    const ssrDefine = { __HADARS_REACT_MAJOR__: String(reactMajor), ...options.define };

    const child = spawn(workerCmd[0]!, [
        ...workerCmd.slice(1),
        `--entry=${entry}`,
        `--outDir=${HadarsFolder}`,
        `--outFile=${SSR_FILENAME}`,
        `--base=${baseURL}`,
        ...(options.swcPlugins ? [`--swcPlugins=${JSON.stringify(options.swcPlugins)}`] : []),
        `--define=${JSON.stringify(ssrDefine)}`,
        ...(options.moduleRules ? [`--moduleRules=${JSON.stringify(options.moduleRules, (_k, v) => v instanceof RegExp ? { __re: v.source, __flags: v.flags } : v)}`] : []),
    ], { stdio: 'pipe' });
    child.stdin?.end();
    await updateLock(HadarsFolder, { childPid: child.pid });

    // Ensure the SSR watcher child is killed and the lock released when this process exits.
    const cleanupChild = () => { try { if (!child.killed) child.kill(); } catch {} };
    const cleanupLock = () => { try { rmSync(lockPath(HadarsFolder), { force: true }); } catch {} };
    process.once('exit', () => { cleanupChild(); cleanupLock(); });
    process.once('SIGINT', () => { cleanupChild(); cleanupLock(); process.exit(0); });
    process.once('SIGTERM', () => { cleanupChild(); cleanupLock(); process.exit(0); });

    // Convert Node.js Readable streams to Web ReadableStream so the rest of
    // the logic works identically across all runtimes.
    const stdoutWebStream = nodeReadableToWebStream(child.stdout!);
    const stderrWebStream = nodeReadableToWebStream(child.stderr!);

    // Wait for worker to emit the initial build completion marker.
    const marker = 'ssr-watch: initial-build-complete';
    const rebuildMarker = 'ssr-watch: SSR rebuilt';
    const decoder = new TextDecoder();
    // Hoist so the async continuation loop below can keep using it.
    let stdoutReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const ssrBuildDone = (async () => {
        let gotMarker = false;
        try {
            stdoutReader = stdoutWebStream.getReader();
            let buf = '';
            const start = Date.now();
            const timeoutMs = 20000;
            while (Date.now() - start < timeoutMs) {
                const { done, value } = await stdoutReader.read();
                if (done) { stdoutReader = null; break; }
                const chunk = decoder.decode(value, { stream: true });
                buf += chunk;
                try { process.stdout.write(chunk); } catch (e) { /* ignore */ }
                if (buf.includes(marker)) {
                    gotMarker = true;
                    break;
                }
            }
            if (!gotMarker) {
                console.warn('SSR worker did not signal initial build completion within timeout');
            }
        } catch (err) {
            console.error('Error reading SSR worker output', err);
            stdoutReader = null;
        }
    })();

    // Both builds run in parallel — this promise resolves when they're both done.
    // We do NOT await it here; the server starts immediately below so that the
    // port is bound right away. Incoming requests await this promise before
    // processing, so they hold in-flight and all resolve together once ready.
    const readyPromise = Promise.all([clientBuildDone, ssrBuildDone]);

    readyPromise.then(async () => {
        // Generate image variants once after the initial build so /_images/ URLs
        // resolve correctly in dev — falls back to the original <img src> if skipped.
        if (options.images) {
            try {
                const { optimizeImages } = await import('./utils/imageOptimizer');
                const projectStaticDir = pathMod.resolve(__dirname, 'static');
                const hadarStaticDir = pathMod.resolve(__dirname, StaticPath);
                await optimizeImages(projectStaticDir, hadarStaticDir, options.images);
            } catch (err) {
                console.warn('[hadars] Image optimization failed in dev mode:', err);
            }
        }

        // Continue reading stdout to forward logs and pick up SSR rebuild signals.
        if (stdoutReader) {
            const reader = stdoutReader as ReadableStreamDefaultReader<Uint8Array>;
            (async () => {
                // Accumulate into a rolling buffer, same as the initial-marker wait
                // above — a single reader.read() chunk can split the marker text
                // in half (e.g. right after a large rspack stats dump flushes), and
                // checking only the latest chunk in isolation can silently miss it
                // forever, leaving ssrBuildId stuck and the dev server serving the
                // first SSR module it ever imported no matter how many times the
                // bundle is rebuilt afterward.
                let rebuildBuf = '';
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value, { stream: true });
                        try { process.stdout.write(chunk); } catch (e) { }
                        rebuildBuf += chunk;
                        if (rebuildBuf.includes(rebuildMarker)) {
                            ssrBuildId = crypto.randomBytes(4).toString('hex');
                            console.log('[hadars] SSR bundle updated, build id:', ssrBuildId);
                            rebuildBuf = '';
                        } else if (rebuildBuf.length > rebuildMarker.length * 4) {
                            // Bound the buffer so it can't grow unbounded over a long
                            // dev session, while keeping enough tail to still catch a
                            // marker split across the next chunk boundary.
                            rebuildBuf = rebuildBuf.slice(-rebuildMarker.length);
                        }
                    }
                } catch (e) { }
            })();
        }
    });

    // Forward stderr asynchronously
    (async () => {
        try {
            const r = stderrWebStream.getReader();
            while (true) {
                const { done, value } = await r.read();
                if (done) break;
                try { process.stderr.write(decoder.decode(value)); } catch (e) { }
            }
        } catch (e) { }
    })();

    const getPrecontentHtml = makePrecontentHtmlGetter(
        readyPromise.then(() => fs.readFile(pathMod.join(__dirname, StaticPath, 'out.html'), 'utf-8'))
    );
    const projectStaticPath = pathMod.resolve(process.cwd(), 'static');

    // Track whether the client compiler is mid-compilation, so the first page can
    // be held until it settles.
    //
    // readyPromise only covers the FIRST client build. If something invalidates the
    // compiler right after that (the SSR watcher completing its own initial build
    // is the observed case), a browser can load in the gap and connect just as the
    // next compilation finishes. RspackDevServer sends every newly-connected client
    // the latest stats hash, so that browser starts life holding hash N while the
    // most recent update chunk on disk is named for N-1 — and the chunk for N will
    // not exist until another compilation runs. Its first edit then requests a file
    // that isn't there, 404s, and the update chain stalls with no way to recover
    // short of a manual reload.
    //
    // Holding the initial page until the compiler is idle closes that window: the
    // browser connects against a settled hash.
    let clientCompiling = false;
    (clientCompiler as any).hooks.invalid.tap('hadars-track-compiling', () => { clientCompiling = true; });
    (clientCompiler as any).hooks.done.tap('hadars-track-compiling', () => { clientCompiling = false; });

    const waitForClientIdle = async () => {
        // Bounded: never hang a request if something keeps the compiler busy.
        const deadline = Date.now() + 10_000;
        while (clientCompiling && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 50));
        }
    };

    await serve(port, async (req, ctx) => {
        // Hold requests until both builds are ready. Once resolved this is a no-op.
        await readyPromise;
        // Then hold until the client compiler is idle, so the browser never connects
        // mid-compilation and inherit a hash whose update chunk does not exist yet.
        await waitForClientIdle();
        // Stop counting startup recompiles once we begin serving (debug only).
        (globalThis as any).__hadarsMarkPageServed?.();
        const request = parseRequest(req);
        if (handler) {
            const res = await handler(request);
            if (res) return res;
        }
        if (handleWS && handleWS(request, ctx)) return undefined;

        if (handleGraphiql) {
            const graphiqlRes = await handleGraphiql(req);
            if (graphiqlRes) return graphiqlRes;
        }

        const proxied = await handleProxy(request);
        if (proxied) return proxied;

        const url = new URL(request.url);
        const path = url.pathname;

        // static files in the hadars output folder — uncached: dev is a
        // long-lived session and a file that 404'd once (e.g. requested
        // before it existed) can legitimately appear later.
        const staticRes = await tryServeFile(pathMod.join(__dirname, StaticPath, path));
        if (staticRes) return staticRes;

        // project-level static/ directory (explicit paths only — never intercept root)
        const projectRes = await tryServeFile(pathMod.join(projectStaticPath, path));
        if (projectRes) return projectRes;

        const ssrComponentPath = pathMod.join(__dirname, HadarsFolder, SSR_FILENAME);

        try {
            if (ssrBuildId !== cachedSsrBuildId) {
                // Import a physically distinct file per build rather than the same
                // path with a `?query` cache-buster appended: at least on Bun,
                // dynamic import() of a local file resolves/caches by path alone
                // and ignores the query string, so re-importing the same path with
                // a new query silently returns the module already in the cache —
                // ssrBuildId rotates, the bundle on disk is genuinely new, and the
                // server keeps serving what it loaded on the very first request.
                // A new file path can't collide with a stale cache entry in any
                // runtime's module registry.
                const uniqueSsrPath = pathMod.join(SsrImportDir, `index.ssr.${ssrBuildId}.js`);
                await fs.copyFile(ssrComponentPath, uniqueSsrPath);
                cachedSsrModule = (await import(pathToFileURL(uniqueSsrPath).href)) as HadarsEntryModule<any>;
                cachedSsrBuildId = ssrBuildId;
                if (previousSsrImportPath) {
                    fs.rm(previousSsrImportPath, { force: true }).catch(() => {});
                }
                previousSsrImportPath = uniqueSsrPath;
            }
            const {
                default: Component,
                getInitProps,
                getFinalProps,
            } = cachedSsrModule!;

            // Expose the executor globally so useGraphQL() in components can reach it.
            (globalThis as any).__hadarsGraphQL = devStaticCtx?.graphql;

            const isDataOnly = request.headers.get('Accept') === 'application/json';
            const { head, status, getAppBody, finalize } = await getReactResponse(request, {
                document: {
                    body: Component as React.FC<HadarsProps<object>>,
                    lang: 'en',
                    getInitProps,
                    getFinalProps,
                },
                staticCtx: devStaticCtx,
                singlePass: !isDataOnly,
                dataOnly: isDataOnly,
            });

            // Content negotiation: if the client only accepts JSON (client-side
            // navigation via useServerData), return the resolved data map as JSON
            // instead of a full HTML page. The same auth context applies — cookies
            // and headers are forwarded unchanged, so no new attack surface is created.
            if (isDataOnly) {
                const { clientProps } = await finalize();
                const serverData = (clientProps as any).__serverData ?? {};
                return new Response(JSON.stringify({ serverData }), {
                    status,
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                });
            }

            return buildSsrResponse(head, status, getAppBody, finalize, getPrecontentHtml);
        } catch (err: any) {
            console.error('[hadars] SSR render error:', err);
            options.onError?.(err, request)?.catch?.(() => {});
            const msg = (err?.stack ?? err?.message ?? String(err)).replace(/</g, '&lt;');
            return new Response(`<!doctype html><pre style="white-space:pre-wrap">${msg}</pre>`, {
                status: 500,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }
    }, options.websocket);
};

export const build = async (options: HadarsRuntimeOptions) => {
    validateOptions(options);

    const liveLock = await checkLiveLock(HadarsFolder);
    if (liveLock) {
        console.error(
            `[hadars] A dev server (pid ${liveLock.pid}${liveLock.childPid ? `, worker pid ${liveLock.childPid}` : ''}) ` +
            `is still writing to ${HadarsFolder}/. Building now would race it and can leave a dev bundle in place ` +
            `of the production build. Stop it first with \`hadars stop\`.`
        );
        process.exit(1);
    }

    const entry = pathMod.resolve(__dirname, options.entry);

    // prepare client script
    const packageDir = pathMod.dirname(fileURLToPath(import.meta.url));
    const clientScriptPath = pathMod.resolve(packageDir, 'utils', 'clientScript.js');
    let clientScript = '';
    try {
        clientScript = (await fs.readFile(clientScriptPath, 'utf-8'))
            .replace('$_MOD_PATH$', entry + getSuffix(options.mode));
    } catch (err) {
        const srcClientPath = pathMod.resolve(packageDir, 'utils', 'clientScript.tsx');
        clientScript = (await fs.readFile(srcClientPath, 'utf-8'))
            .replace('$_MOD_PATH$', entry + getSuffix(options.mode));
    }

    await ensureHadarsTmpDir();
    const tmpFilePath = pathMod.join(HADARS_TMP_DIR, `client-${Date.now()}.tsx`);
    await fs.writeFile(tmpFilePath, clientScript);

    // Pre-process the HTML template's <style> blocks through PostCSS (e.g. Tailwind).
    const resolvedHtmlTemplate = options.htmlTemplate
        ? await processHtmlTemplate(pathMod.resolve(__dirname, options.htmlTemplate))
        : undefined;

    // Compile client and SSR bundles in parallel — they write to different
    // output directories and use different entry files, so they are fully
    // independent and safe to run concurrently.
    const reactMajor = await readReactMajor();

    console.log("Building client and server bundles in parallel...");
    await Promise.all([
        compileEntry(tmpFilePath, {
            target: 'web',
            output: {
                // Content hash: filename is stable when code is unchanged → better browser/CDN cache.
                filename: 'index.[contenthash:8].js',
                path: pathMod.resolve(__dirname, StaticPath),
            },
            base: options.baseURL,
            mode: 'production',
            swcPlugins: options.swcPlugins,
            define: options.define,
            moduleRules: options.moduleRules,
            plugins: options.plugins,
            postcssPlugins: options.postcssPlugins,
            optimization: options.optimization,
            reactMode: options.reactMode,
            htmlTemplate: resolvedHtmlTemplate,
        }),
        compileEntry(pathMod.resolve(__dirname, options.entry), {
            output: {
                iife: false,
                filename: SSR_FILENAME,
                path: pathMod.resolve(__dirname, HadarsFolder),
                publicPath: '',
                library: { type: 'module' },
            },
            base: options.baseURL,
            target: 'node',
            mode: 'production',
            swcPlugins: options.swcPlugins,
            define: { __HADARS_REACT_MAJOR__: String(reactMajor), ...options.define },
            moduleRules: options.moduleRules,
            plugins: options.plugins,
            postcssPlugins: options.postcssPlugins,
        }),
    ]);
    await fs.rm(tmpFilePath);

    // Copy the project's static/ directory into .hadars/static/. dev()/run()
    // already serve project-root static/ directly from disk, but
    // `hadars export static` only copies .hadars/static/ into the output
    // folder — without this, anything placed in the project's static/ dir
    // (e.g. i18n message JSON under static/locales/) would work in dev/run
    // but silently go missing from a static export.
    // force: false skips any path that already exists in .hadars/static/
    // (build output — JS/CSS bundles, out.html) rather than clobbering it.
    {
        const projectStaticDirAll = pathMod.resolve(__dirname, 'static');
        const hadarStaticDirAll = pathMod.resolve(__dirname, StaticPath);
        if (existsSync(projectStaticDirAll)) {
            await fs.cp(projectStaticDirAll, hadarStaticDirAll, { recursive: true, force: false });
        }
    }

    // Generate image variants if `images` is configured in hadars.config.ts.
    // Source images come from the project's static/ directory; variants are
    // written to .hadars/static/_images/ and served at /_images/<path> by run().
    if (options.images) {
        const { optimizeImages } = await import('./utils/imageOptimizer');
        const projectStaticDir = pathMod.resolve(__dirname, 'static');
        const hadarStaticDir = pathMod.resolve(__dirname, StaticPath);
        await optimizeImages(projectStaticDir, hadarStaticDir, options.images);
    }

    // Translation-key parity warning — non-fatal by design. A locale that's
    // only partially translated shouldn't block a build (t() still falls
    // back to the raw key at runtime), but it should be impossible to miss.
    if (options.i18n?.defaultLocale) {
        await warnLocaleParity(options.i18n);
    }

    console.log("Build complete.");
};

/**
 * Scans `static/<localesDir>/<locale>/<namespace>.json`, builds the message
 * tree, and prints a console warning listing any translation-key mismatches
 * against `defaultLocale` — via the same `checkLocaleParity` used for
 * unit testing and the standalone `scripts/check-i18n-parity.ts` pattern.
 * Any error here (bad JSON, missing directory) is itself only warned about —
 * this check must never fail a build.
 */
async function warnLocaleParity(i18n: { defaultLocale: string; localesDir?: string }): Promise<void> {
    try {
        const { checkLocaleParity, formatParityIssues } = await import('./i18n');
        const localesDir = pathMod.resolve(process.cwd(), 'static', i18n.localesDir ?? 'locales');
        if (!existsSync(localesDir)) return;

        const tree: Record<string, Record<string, Record<string, string>>> = {};
        const localeEntries = await fs.readdir(localesDir, { withFileTypes: true });

        for (const localeEntry of localeEntries) {
            if (!localeEntry.isDirectory()) continue;
            const locale = localeEntry.name;
            tree[locale] = {};

            const fileEntries = await fs.readdir(pathMod.join(localesDir, locale), { withFileTypes: true });
            for (const fileEntry of fileEntries) {
                if (!fileEntry.isFile() || !fileEntry.name.endsWith('.json')) continue;
                const namespace = fileEntry.name.replace(/\.json$/, '');
                const raw = await fs.readFile(pathMod.join(localesDir, locale, fileEntry.name), 'utf-8');
                tree[locale][namespace] = JSON.parse(raw);
            }
        }

        if (!tree[i18n.defaultLocale]) {
            console.warn(`[hadars] i18n: base locale "${i18n.defaultLocale}" not found under static/${i18n.localesDir ?? 'locales'}/ — skipping parity check.`);
            return;
        }

        const issues = checkLocaleParity(tree, i18n.defaultLocale);
        if (issues.length === 0) return;

        console.warn(`\n[hadars] i18n: ${issues.length} translation parity mismatch(es) against base locale "${i18n.defaultLocale}":\n`);
        console.warn(formatParityIssues(issues));
        console.warn('');
    } catch (err) {
        console.warn('[hadars] i18n parity check skipped due to an error:', err instanceof Error ? err.message : err);
    }
}

export const run = async (options: HadarsRuntimeOptions) => {
    validateOptions(options);

    let { port = 9090, workers = 1 } = options;
    const clustered = isNode && workers > 1;

    // Lock tracking is scoped to the common single-process case. A clustered
    // run() re-executes this function once per forked worker, which would
    // stomp on a single lock file — skip it there rather than track N pids.
    if (!clustered) {
        const liveLock = await checkLiveLock(HadarsFolder);
        if (liveLock) {
            console.error(
                `[hadars] Another hadars process (pid ${liveLock.pid}${liveLock.childPid ? `, worker pid ${liveLock.childPid}` : ''}) ` +
                `already holds ${HadarsFolder}/ (and possibly port ${liveLock.port}). Run \`hadars stop\` first, or verify with \`lsof -i :${port}\`.`
            );
            process.exit(1);
        }
        await writeLock(HadarsFolder, { pid: process.pid, port, startedAt: Date.now() });
        const cleanupLock = () => { try { rmSync(lockPath(HadarsFolder), { force: true }); } catch {} };
        process.once('exit', cleanupLock);
        process.once('SIGINT', () => { cleanupLock(); process.exit(0); });
        process.once('SIGTERM', () => { cleanupLock(); process.exit(0); });
    }

    // On Node.js, fork worker processes so every CPU core handles requests.
    // The primary process only manages the cluster; workers fall through to
    // the serve() call below. On Bun/Deno this is skipped — Bun has its own
    // multi-threaded I/O model and doesn't need OS-level process forking.
    if (clustered && cluster.isPrimary) {
        console.log(`[hadars] Starting ${workers} worker processes on port ${port}`);
        for (let i = 0; i < workers; i++) {
            cluster.fork();
        }
        cluster.on('exit', (worker, code, signal) => {
            console.warn(`[hadars] Worker ${worker.process.pid} exited (${signal ?? code}), restarting...`);
            cluster.fork();
        });
        await new Promise(() => {}); // keep primary alive; workers handle requests
        return;
    }

    const handleProxy = createProxyHandler(options);
    const handleWS = upgradeHandler(options);
    const handler = options.fetch;

    console.log(`Starting Hadars (run) on port ${port}`);

    // On Bun/Deno, node:cluster is unavailable, so we use a worker_threads
    // render pool to parallelize the synchronous renderToString step instead.
    let renderPool: RenderWorkerPool | undefined;
    if (!isNode && workers > 1) {
        const packageDir = pathMod.dirname(fileURLToPath(import.meta.url));
        const workerJs = pathMod.resolve(packageDir, 'ssr-render-worker.js');
        const workerTs = pathMod.resolve(packageDir, 'ssr-render-worker.ts');
        const workerFile = existsSync(workerJs) ? workerJs : workerTs;
        const ssrBundlePath = pathMod.resolve(__dirname, HadarsFolder, SSR_FILENAME);
        renderPool = new RenderWorkerPool(workerFile, workers, ssrBundlePath);
        console.log(`[hadars] SSR render pool: ${workers} worker threads`);
    }

    const getPrecontentHtml = makePrecontentHtmlGetter(
        fs.readFile(pathMod.join(__dirname, StaticPath, 'out.html'), 'utf-8')
    );
    const projectStaticPath = pathMod.resolve(process.cwd(), 'static');

    // Hoist and pre-import the SSR module at startup so the first request does
    // not pay the module parse/eval cost.  The file: URL is stable for the life
    // of the process (no cache-busting needed in run mode).
    const componentPath = pathToFileURL(
        pathMod.resolve(__dirname, HadarsFolder, SSR_FILENAME)
    ).href;
    const ssrModulePromise = import(componentPath) as Promise<HadarsEntryModule<any>>;

    const runHandler: CacheFetchHandler = async (req, ctx) => {
        const request = parseRequest(req);
        if (handler) {
            const res = await handler(request);
            if (res) return res;
        }
        if (handleWS && handleWS(request, ctx)) return undefined;

        const proxied = await handleProxy(request);
        if (proxied) return proxied;

        const url = new URL(request.url);
        const path = url.pathname;

        // static files in the hadars output folder
        const staticRes = await tryServeFileCached(pathMod.join(__dirname, StaticPath, path));
        if (staticRes) return staticRes;

        // project-level static/ directory (explicit paths only — never intercept root)
        const projectRes = await tryServeFileCached(pathMod.join(projectStaticPath, path));
        if (projectRes) return projectRes;

        // route-based fallback: try <path>/index.html
        const routeClean = path.replace(/(^\/|\/$)/g, '');
        if (routeClean) {
            const routeRes = await tryServeFileCached(
                pathMod.join(__dirname, StaticPath, routeClean, 'index.html')
            );
            if (routeRes) return routeRes;
        }

        try {
            const {
                default: Component,
                getInitProps,
                getFinalProps,
            } = await ssrModulePromise;

            if (renderPool && request.headers.get('Accept') !== 'application/json') {
                // Worker runs the full lifecycle — no non-serializable objects cross the thread boundary.
                const serialReq = await serializeRequest(request);
                const { html, headHtml: wHead, status: wStatus } = await renderPool.renderFull(serialReq);
                const [precontentHtml, postContent] = await getPrecontentHtml(wHead);
                return new Response(precontentHtml + html + postContent, {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                    status: wStatus,
                });
            }

            const isDataOnly = request.headers.get('Accept') === 'application/json';
            const { head, status, getAppBody, finalize } = await getReactResponse(request, {
                document: {
                    body: Component as React.FC<HadarsProps<object>>,
                    lang: 'en',
                    getInitProps,
                    getFinalProps,
                },
                singlePass: !isDataOnly,
                dataOnly: isDataOnly,
            });

            // Content negotiation: if the client only accepts JSON (client-side
            // navigation via useServerData), return the resolved data map as JSON
            // instead of a full HTML page.
            if (isDataOnly) {
                const { clientProps } = await finalize();
                const serverData = (clientProps as any).__serverData ?? {};
                return new Response(JSON.stringify({ serverData }), {
                    status,
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                });
            }

            return buildSsrResponse(head, status, getAppBody, finalize, getPrecontentHtml);
        } catch (err: any) {
            console.error('[hadars] SSR render error:', err);
            options.onError?.(err, request)?.catch?.(() => {});
            return new Response('Internal Server Error', { status: 500 });
        }
    };

    await serve(
        port,
        options.cache ? createRenderCache(options.cache, runHandler) : runHandler,
        options.websocket,
    );
};
