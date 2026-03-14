import { createProxyHandler } from "./utils/proxyHandler";
import { parseRequest } from "./utils/request";
import { upgradeHandler } from "./utils/upgradeRequest";
import { getReactResponse } from "./utils/response";
import { createClientCompiler, compileEntry } from "./utils/rspack";
import { serve, nodeReadableToWebStream } from "./utils/serve";
import { tryServeFile } from "./utils/staticFile";
import { isBun, isDeno, isNode } from "./utils/runtime";
import { RspackDevServer } from "@rspack/dev-server";
import pathMod from "node:path";
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import cluster from 'node:cluster';
import type { HadarsEntryModule, HadarsOptions, HadarsProps } from "./types/hadars";
const encoder = new TextEncoder();

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

const HEAD_MARKER = '<meta name="HADARS_HEAD">';
const BODY_MARKER = '<meta name="HADARS_BODY">';



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
            const { id, html, headHtml, status, error } = msg;
            const p = this.pending.get(id);
            if (!p) return;
            this.pending.delete(id);
            this.workerPending.get(w)?.delete(id);
            if (error) p.reject(new Error(error));
            else p.resolve({ html, headHtml, status });
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

async function buildSsrResponse(
    bodyHtml: string,
    clientProps: Record<string, unknown>,
    headHtml: string,
    status: number,
    getPrecontentHtml: (headHtml: string) => Promise<[string, string]>,
): Promise<Response> {
    const responseStream = new ReadableStream({
        async start(controller) {
            const [precontentHtml, postContent] = await getPrecontentHtml(headHtml);
            // Flush the shell (precontentHtml) immediately so the browser can
            // start loading CSS/fonts before the body is assembled.
            controller.enqueue(encoder.encode(precontentHtml));

            const scriptContent = JSON.stringify({ hadars: { props: clientProps } }).replace(/</g, '\\u003c');
            controller.enqueue(encoder.encode(
                `<div id="app">${bodyHtml}</div><script id="hadars" type="application/json">${scriptContent}</script>` + postContent
            ));
            controller.close();
        },
    });

    return new Response(responseStream, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status,
    });
}

/** Serialize a HadarsRequest into a structure-clonable object for postMessage. */
async function serializeRequest(req: any): Promise<SerializableRequest> {
    const isGetOrHead = ['GET', 'HEAD'].includes(req.method ?? 'GET');
    const body = isGetOrHead ? null : new Uint8Array(await req.clone().arrayBuffer());
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

/**
 * Returns a function that parses `out.html` into pre-head, post-head, and
 * post-content segments and caches the result. Call the returned function with
 * the per-request headHtml to produce the full HTML prefix and suffix.
 */
const makePrecontentHtmlGetter = (htmlFilePromise: Promise<string>) => {
    let preHead: string | null = null;
    let postHead: string | null = null;
    let postContent: string | null = null;
    return async (headHtml: string): Promise<[string, string]> => {
        if (preHead === null || postHead === null || postContent === null) {
            const html = await htmlFilePromise;
            const headEnd = html.indexOf(HEAD_MARKER);
            const contentStart = html.indexOf(BODY_MARKER);
            preHead = html.slice(0, headEnd);
            postHead = html.slice(headEnd + HEAD_MARKER.length, contentStart);
            postContent = html.slice(contentStart + BODY_MARKER.length);
        }
        return [preHead! + headHtml + postHead!, postContent!];
    };
};

// ── SSR response cache ────────────────────────────────────────────────────────

interface CacheEntry {
    /** Gzip-compressed response body — much cheaper to keep in RAM than raw HTML. */
    body: Uint8Array;
    status: number;
    /** Headers with Content-Encoding: gzip already set. */
    headers: [string, string][];
    expiresAt: number | null;
}

type CacheFetchHandler = (req: Request, ctx: any) => Promise<Response | undefined>;

async function transformStream(data: Uint8Array, stream: { writable: WritableStream; readable: ReadableStream<Uint8Array> }): Promise<Uint8Array> {
    const writer = stream.writable.getWriter();
    writer.write(data);
    writer.close();
    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
}

const gzipCompress   = (d: Uint8Array) => transformStream(d, new (globalThis as any).CompressionStream('gzip'));
const gzipDecompress = (d: Uint8Array) => transformStream(d, new (globalThis as any).DecompressionStream('gzip'));

async function buildCacheEntry(res: Response, ttl: number | undefined): Promise<CacheEntry> {
    const buf = await res.arrayBuffer();
    const body = await gzipCompress(new Uint8Array(buf));
    const headers: [string, string][] = [];
    res.headers.forEach((v, k) => {
        if (k.toLowerCase() !== 'content-encoding' && k.toLowerCase() !== 'content-length') {
            headers.push([k, v]);
        }
    });
    headers.push(['content-encoding', 'gzip']);
    return { body, status: res.status, headers, expiresAt: ttl != null ? Date.now() + ttl : null };
}

async function serveFromEntry(entry: CacheEntry, req: Request): Promise<Response> {
    const accept = req.headers.get('Accept-Encoding') ?? '';
    if (accept.includes('gzip')) {
        return new Response(entry.body.buffer as ArrayBuffer, { status: entry.status, headers: entry.headers });
    }
    // Client doesn't support gzip — decompress before serving
    const plain = await gzipDecompress(entry.body);
    const headers = entry.headers.filter(([k]) => k.toLowerCase() !== 'content-encoding');
    return new Response(plain.buffer as ArrayBuffer, { status: entry.status, headers });
}

function createRenderCache(
    opts: NonNullable<HadarsOptions['cache']>,
    handler: CacheFetchHandler,
): CacheFetchHandler {
    const store    = new Map<string, CacheEntry>();
    // Single-flight map: coalesces concurrent misses for the same key onto one render.
    const inFlight = new Map<string, Promise<CacheEntry | null>>();

    return async (req, ctx) => {
        const hadarsReq = parseRequest(req);
        const cacheOpts = await opts(hadarsReq);
        const key = cacheOpts?.key ?? null;

        if (key != null) {
            const entry = store.get(key);
            if (entry) {
                const expired = entry.expiresAt != null && Date.now() >= entry.expiresAt;
                if (!expired) {
                    return serveFromEntry(entry, req);
                }
                store.delete(key);
            }

            // Single-flight: if a render for this key is already in progress, await
            // it instead of starting a duplicate render (thundering herd prevention).
            let flight = inFlight.get(key);
            if (!flight) {
                const ttl = cacheOpts?.ttl;
                flight = handler(new Request(req), ctx)
                    .then(async (res) => {
                        if (!res || res.status < 200 || res.status >= 300 || res.headers.has('set-cookie')) {
                            return null;
                        }
                        const newEntry = await buildCacheEntry(res, ttl);
                        store.set(key, newEntry);
                        return newEntry;
                    })
                    .catch(() => null)
                    .finally(() => inFlight.delete(key));
                inFlight.set(key, flight);
            }

            const newEntry = await flight;
            if (newEntry) return serveFromEntry(newEntry, req);
            // Render was uncacheable (error, Set-Cookie, etc.) — fall through to a
            // fresh independent render for this request so it still gets a response.
        }

        return handler(req, ctx);
    };
}

interface HadarsRuntimeOptions extends HadarsOptions {
    mode: "development" | "production";
}

const SSR_FILENAME = 'index.ssr.js';
const __dirname = process.cwd();

type Mode = "development" | "production";

const getSuffix = (mode: Mode) => mode === 'development' ? `?v=${Date.now()}` : '';

const HadarsFolder = './.hadars';
const StaticPath = `${HadarsFolder}/static`;
// Dedicated temp directory — keeps all hadars temp files out of the root of
// os.tmpdir() so rspack's file watcher doesn't traverse unrelated system files
// (e.g. Steam/Chrome shared-memory device files) in that directory.
const HADARS_TMP_DIR = pathMod.join(os.tmpdir(), 'hadars');
const ensureHadarsTmpDir = () => fs.mkdir(HADARS_TMP_DIR, { recursive: true });

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

    // clean .hadars
    await fs.rm(HadarsFolder, { recursive: true, force: true });

    let { port = 9090, baseURL = '' } = options;

    console.log(`Starting Hadars on port ${port}`);

    validateOptions(options);
    const handleProxy = createProxyHandler(options);
    const handleWS = upgradeHandler(options);
    const handler = options.fetch;

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
        },
        base: baseURL,
        mode: 'development',
        swcPlugins: options.swcPlugins,
        define: options.define,
        moduleRules: options.moduleRules,
        reactMode: options.reactMode,
        htmlTemplate: resolvedHtmlTemplate,
    });

    const devServer = new RspackDevServer({
        port: hmrPort,
        hot: true,
        liveReload: false,
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

    // Kick off client build — does NOT await here so SSR worker can start in parallel.
    let clientResolved = false;
    const clientBuildDone = new Promise<void>((resolve, reject) => {
        (clientCompiler as any).hooks.done.tap('initial-build', (stats: any) => {
            if (!clientResolved) {
                clientResolved = true;
                console.log(stats.toString({ colors: true }));
                resolve();
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

    const child = spawn(workerCmd[0]!, [
        ...workerCmd.slice(1),
        `--entry=${entry}`,
        `--outDir=${HadarsFolder}`,
        `--outFile=${SSR_FILENAME}`,
        `--base=${baseURL}`,
        ...(options.swcPlugins ? [`--swcPlugins=${JSON.stringify(options.swcPlugins)}`] : []),
        ...(options.define ? [`--define=${JSON.stringify(options.define)}`] : []),
        ...(options.moduleRules ? [`--moduleRules=${JSON.stringify(options.moduleRules, (_k, v) => v instanceof RegExp ? { __re: v.source, __flags: v.flags } : v)}`] : []),
    ], { stdio: 'pipe' });
    child.stdin?.end();

    // Ensure the SSR watcher child is killed when this process exits.
    const cleanupChild = () => { try { if (!child.killed) child.kill(); } catch {} };
    process.once('exit', cleanupChild);
    process.once('SIGINT', () => { cleanupChild(); process.exit(0); });
    process.once('SIGTERM', () => { cleanupChild(); process.exit(0); });

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

    readyPromise.then(() => {
        // Continue reading stdout to forward logs and pick up SSR rebuild signals.
        if (stdoutReader) {
            const reader = stdoutReader as ReadableStreamDefaultReader<Uint8Array>;
            (async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value, { stream: true });
                        try { process.stdout.write(chunk); } catch (e) { }
                        if (chunk.includes(rebuildMarker)) {
                            ssrBuildId = crypto.randomBytes(4).toString('hex');
                            console.log('[hadars] SSR bundle updated, build id:', ssrBuildId);
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

    await serve(port, async (req, ctx) => {
        // Hold requests until both builds are ready. Once resolved this is a no-op.
        await readyPromise;
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
        const staticRes = await tryServeFile(pathMod.join(__dirname, StaticPath, path));
        if (staticRes) return staticRes;

        // project-level static/ directory (explicit paths only — never intercept root)
        const projectStaticPath = pathMod.resolve(process.cwd(), 'static');
        const projectRes = await tryServeFile(pathMod.join(projectStaticPath, path));
        if (projectRes) return projectRes;

        const ssrComponentPath = pathMod.join(__dirname, HadarsFolder, SSR_FILENAME);
        // Use a file: URL so the ?t= suffix is treated as a URL query string
        // (cache-busting key) rather than a literal filename character on Linux.
        const importPath = pathToFileURL(ssrComponentPath).href + `?t=${ssrBuildId}`;

        try {
            const {
                default: Component,
                getInitProps,
                getAfterRenderProps,
                getFinalProps,
            } = (await import(importPath)) as HadarsEntryModule<any>;

            const { bodyHtml, clientProps, status, headHtml } = await getReactResponse(request, {
                document: {
                    body: Component as React.FC<HadarsProps<object>>,
                    lang: 'en',
                    getInitProps,
                    getAfterRenderProps,
                    getFinalProps,
                },
            });

            // Content negotiation: if the client only accepts JSON (client-side
            // navigation via useServerData), return the resolved data map as JSON
            // instead of a full HTML page. The same auth context applies — cookies
            // and headers are forwarded unchanged, so no new attack surface is created.
            if (request.headers.get('Accept') === 'application/json') {
                const serverData = (clientProps as any).__serverData ?? {};
                return new Response(JSON.stringify({ serverData }), {
                    status,
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                });
            }

            return buildSsrResponse(bodyHtml, clientProps, headHtml, status, getPrecontentHtml);
        } catch (err: any) {
            console.error('[hadars] SSR render error:', err);
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
            .replace('$_MOD_PATH$', entry + `?v=${Date.now()}`);
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
            define: options.define,
            moduleRules: options.moduleRules,
        }),
    ]);
    await fs.rm(tmpFilePath);
    console.log("Build complete.");
};

export const run = async (options: HadarsRuntimeOptions) => {
    validateOptions(options);

    let { port = 9090, workers = 1 } = options;

    // On Node.js, fork worker processes so every CPU core handles requests.
    // The primary process only manages the cluster; workers fall through to
    // the serve() call below. On Bun/Deno this is skipped — Bun has its own
    // multi-threaded I/O model and doesn't need OS-level process forking.
    if (isNode && workers > 1 && cluster.isPrimary) {
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
        const staticRes = await tryServeFile(pathMod.join(__dirname, StaticPath, path));
        if (staticRes) return staticRes;

        // project-level static/ directory (explicit paths only — never intercept root)
        const projectStaticPath = pathMod.resolve(process.cwd(), 'static');
        const projectRes = await tryServeFile(pathMod.join(projectStaticPath, path));
        if (projectRes) return projectRes;

        // route-based fallback: try <path>/index.html
        const routeClean = path.replace(/(^\/|\/$)/g, '');
        if (routeClean) {
            const routeRes = await tryServeFile(
                pathMod.join(__dirname, StaticPath, routeClean, 'index.html')
            );
            if (routeRes) return routeRes;
        }

        const componentPath = pathToFileURL(
            pathMod.resolve(__dirname, HadarsFolder, SSR_FILENAME)
        ).href;

        try {
            const {
                default: Component,
                getInitProps,
                getAfterRenderProps,
                getFinalProps,
            } = (await import(componentPath)) as HadarsEntryModule<any>;

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

            const { bodyHtml, clientProps, status, headHtml } = await getReactResponse(request, {
                document: {
                    body: Component as React.FC<HadarsProps<object>>,
                    lang: 'en',
                    getInitProps,
                    getAfterRenderProps,
                    getFinalProps,
                },
            });

            // Content negotiation: if the client only accepts JSON (client-side
            // navigation via useServerData), return the resolved data map as JSON
            // instead of a full HTML page.
            if (request.headers.get('Accept') === 'application/json') {
                const serverData = (clientProps as any).__serverData ?? {};
                return new Response(JSON.stringify({ serverData }), {
                    status,
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                });
            }

            return buildSsrResponse(bodyHtml, clientProps, headHtml, status, getPrecontentHtml);
        } catch (err: any) {
            console.error('[hadars] SSR render error:', err);
            return new Response('Internal Server Error', { status: 500 });
        }
    };

    await serve(
        port,
        options.cache ? createRenderCache(options.cache, runHandler) : runHandler,
        options.websocket,
    );
};
