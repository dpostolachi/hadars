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
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import cluster from 'node:cluster';
import type { HadarsEntryModule, HadarsOptions, HadarsProps } from "./types/ninety";

const encoder = new TextEncoder();

const HEAD_MARKER = '<meta name="NINETY_HEAD">';
const BODY_MARKER = '<meta name="NINETY_BODY">';

// Resolve react-dom/server.browser from the *project's* node_modules (process.cwd())
// rather than from hadars's own install location. This guarantees the same React
// instance is used here and in the SSR bundle (which is also built relative to cwd),
// preventing "Invalid hook call" errors when hadars is installed as a file: symlink.
let _renderToReadableStream: ((element: any, options?: any) => Promise<ReadableStream<Uint8Array>>) | null = null;
async function getReadableStreamRenderer(): Promise<(element: any, options?: any) => Promise<ReadableStream<Uint8Array>>> {
    if (!_renderToReadableStream) {
        const req = createRequire(pathMod.resolve(process.cwd(), '__hadars_fake__.js'));
        const resolved = req.resolve('react-dom/server.browser');
        const mod = await import(pathToFileURL(resolved).href);
        _renderToReadableStream = mod.renderToReadableStream;
    }
    return _renderToReadableStream!;
}

// Resolve renderToString from react-dom/server in the project's node_modules.
// Used when streaming is disabled via `streaming: false` in hadars config.
let _renderToString: ((element: any) => string) | null = null;
async function getRenderToString(): Promise<(element: any) => string> {
    if (!_renderToString) {
        const req = createRequire(pathMod.resolve(process.cwd(), '__hadars_fake__.js'));
        const resolved = req.resolve('react-dom/server');
        const mod = await import(pathToFileURL(resolved).href);
        _renderToString = mod.renderToString;
    }
    return _renderToString!;
}

// Round-robin thread pool for SSR rendering — used on Bun/Deno where
// node:cluster is not available but node:worker_threads is.
// Supports three render modes matching the worker's message protocol:
//   staticMarkup — renderToStaticMarkup for lifecycle passes in getReactResponse
//   renderString — renderToString for non-streaming responses
//   renderStream — renderToReadableStream chunks forwarded as a ReadableStream

type PendingRenderString = {
    kind: 'renderString';
    resolve: (html: string) => void;
    reject: (err: Error) => void;
};
type PendingRenderStream = {
    kind: 'renderStream';
    controller: ReadableStreamDefaultController<Uint8Array>;
};
type PendingEntry = PendingRenderString | PendingRenderStream;

class RenderWorkerPool {
    private workers: any[] = [];
    private pending = new Map<number, PendingEntry>();
    private nextId = 0;
    private rrIndex = 0;

    constructor(workerPath: string, size: number, ssrBundlePath: string) {
        // Dynamically import Worker so this class can be defined at module load
        // time without a top-level await.
        this._init(workerPath, size, ssrBundlePath);
    }

    private _init(workerPath: string, size: number, ssrBundlePath: string) {
        import('node:worker_threads').then(({ Worker }) => {
            for (let i = 0; i < size; i++) {
                const w = new Worker(workerPath, { workerData: { ssrBundlePath } });
                w.on('message', (msg: any) => {
                    const { id, type, html, error, chunk } = msg;
                    const p = this.pending.get(id);
                    if (!p) return;

                    if (p.kind === 'renderStream') {
                        if (type === 'chunk') {
                            p.controller.enqueue(chunk as Uint8Array);
                            return; // keep entry until 'done'
                        }
                        this.pending.delete(id);
                        if (type === 'done') p.controller.close();
                        else p.controller.error(new Error(error ?? 'Stream error'));
                        return;
                    }

                    // renderString
                    this.pending.delete(id);
                    if (error) p.reject(new Error(error));
                    else p.resolve(html);
                });
                w.on('error', (err: Error) => {
                    console.error('[hadars] Render worker error:', err);
                });
                this.workers.push(w);
            }
        }).catch(err => {
            console.error('[hadars] Failed to initialise render worker pool:', err);
        });
    }

    private nextWorker() {
        const w = this.workers[this.rrIndex % this.workers.length];
        this.rrIndex++;
        return w;
    }

    /** Offload a full renderToString call. Returns the HTML string. */
    renderString(appProps: Record<string, unknown>, clientProps: Record<string, unknown>): Promise<string> {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            this.pending.set(id, { kind: 'renderString', resolve, reject });
            this.nextWorker().postMessage({ id, type: 'renderString', appProps, clientProps });
        });
    }

    /** Offload a renderToReadableStream call. Returns a ReadableStream fed by
     *  worker chunk messages. */
    renderStream(appProps: Record<string, unknown>, clientProps: Record<string, unknown>): ReadableStream<Uint8Array> {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
            start: (ctrl) => { controller = ctrl; },
        });
        const id = this.nextId++;
        // Store controller before postMessage so the handler is ready when
        // the first chunk arrives.
        this.pending.set(id, { kind: 'renderStream', controller });
        this.nextWorker().postMessage({ id, type: 'renderStream', appProps, clientProps });
        return stream;
    }

    async terminate(): Promise<void> {
        await Promise.all(this.workers.map((w: any) => w.terminate()));
    }
}

async function buildSsrResponse(
    ReactPage: any,
    headHtml: string,
    status: number,
    getPrecontentHtml: (headHtml: string) => Promise<[string, string]>,
    streaming: boolean,
    renderPool?: RenderWorkerPool,
    renderPayload?: { appProps: Record<string, unknown>; clientProps: Record<string, unknown> },
): Promise<Response> {
    // Resolve renderers before touching globalThis.__hadarsUnsuspend.
    // Any await after setting the global would create a window where a concurrent
    // request on the same thread could overwrite it before the render call runs.
    // Loading the renderer first ensures the set→call→clear sequence is synchronous.
    const renderToString = (!streaming && !renderPool) ? await getRenderToString() : null;
    const renderReadableStream = (streaming && !renderPool) ? await getReadableStreamRenderer() : null;

    // Extract the unsuspend cache from renderPayload so non-pool renders can expose
    // resolved useServerData() values to the SSR bundle via globalThis.__hadarsUnsuspend.
    const unsuspendForRender = (renderPayload?.appProps?.context as any)?._unsuspend ?? null;

    if (!streaming) {
        const [precontentHtml, postContent] = await getPrecontentHtml(headHtml);
        let bodyHtml: string;
        if (renderPool && renderPayload) {
            bodyHtml = await renderPool.renderString(renderPayload.appProps, renderPayload.clientProps);
        } else {
            // set → call (synchronous) → clear: no await in between, safe under concurrency
            try {
                (globalThis as any).__hadarsUnsuspend = unsuspendForRender;
                bodyHtml = renderToString!(ReactPage);
            } finally {
                (globalThis as any).__hadarsUnsuspend = null;
            }
        }
        return new Response(precontentHtml + bodyHtml + postContent, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status,
        });
    }

    const responseStream = new ReadableStream({
        async start(controller) {
            const [precontentHtml, postContent] = await getPrecontentHtml(headHtml);
            controller.enqueue(encoder.encode(precontentHtml));

            let bodyStream: ReadableStream<Uint8Array>;
            if (renderPool && renderPayload) {
                bodyStream = renderPool.renderStream(renderPayload.appProps, renderPayload.clientProps);
            } else {
                // React's renderToReadableStream starts rendering synchronously on call,
                // so hooks fire before the returned Promise settles. Set the global
                // immediately before the call and clear right after — no await in between.
                let streamPromise: Promise<ReadableStream<Uint8Array>>;
                try {
                    (globalThis as any).__hadarsUnsuspend = unsuspendForRender;
                    streamPromise = renderReadableStream!(ReactPage);
                } finally {
                    (globalThis as any).__hadarsUnsuspend = null;
                }
                bodyStream = await streamPromise;
            }
            const reader = bodyStream.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(value);
            }

            controller.enqueue(encoder.encode(postContent));
            controller.close();
        },
    });

    return new Response(responseStream, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status,
    });
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

interface HadarsRuntimeOptions extends HadarsOptions {
    mode: "development" | "production";
}

const SSR_FILENAME = 'index.ssr.js';
const __dirname = process.cwd();

type Mode = "development" | "production";

const getSuffix = (mode: Mode) => mode === 'development' ? `?v=${Date.now()}` : '';

const HadarsFolder = './.hadars';
const StaticPath = `${HadarsFolder}/static`;

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

    const headPath = pathMod.resolve(packageDir, 'utils', 'Head');

    let clientScript = '';
    try {
        clientScript = (await fs.readFile(clientScriptPath, 'utf-8'))
            .replace('$_MOD_PATH$', entry + getSuffix(options.mode))
            .replace('$_HEAD_PATH$', headPath);
    }
    catch (err) {
        console.error("Failed to read client script from package dist, falling back to src", err);
        throw err;
    }

    const tmpFilePath = pathMod.join(os.tmpdir(), `hadars-client-${Date.now()}.tsx`);
    await fs.writeFile(tmpFilePath, clientScript);

    // SSR live-reload id to force re-import
    let ssrBuildId = Date.now();

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
    await new Promise<void>((resolve, reject) => {
        let resolved = false;
        (clientCompiler as any).hooks.done.tap('initial-build', (stats: any) => {
            if (!resolved) {
                resolved = true;
                console.log(stats.toString({ colors: true }));
                resolve();
            }
        });
        devServer.start().catch(reject);
    });

    // Start SSR watcher in a separate process to avoid creating two rspack
    // compiler instances in the same process. We use node:child_process.spawn
    // which works on Bun, Node.js, and Deno (via compatibility layer).
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
    ], { stdio: 'pipe' });
    child.stdin?.end();

    // Convert Node.js Readable streams to Web ReadableStream so the rest of
    // the logic works identically across all runtimes.
    const stdoutWebStream = nodeReadableToWebStream(child.stdout!);
    const stderrWebStream = nodeReadableToWebStream(child.stderr!);

    // Wait for worker to emit the initial build completion marker.
    const marker = 'ssr-watch: initial-build-complete';
    const rebuildMarker = 'ssr-watch: SSR rebuilt';
    const decoder = new TextDecoder();
    let gotMarker = false;
    // Hoist so the async continuation loop below can keep using it.
    let stdoutReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
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

    // Continue reading stdout to forward logs and pick up SSR rebuild signals.
    if (stdoutReader) {
        const reader = stdoutReader;
        (async () => {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    try { process.stdout.write(chunk); } catch (e) { }
                    if (chunk.includes(rebuildMarker)) {
                        ssrBuildId = Date.now();
                        console.log('[hadars] SSR bundle updated, build id:', ssrBuildId);
                    }
                }
            } catch (e) { }
        })();
    }

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
        fs.readFile(pathMod.join(__dirname, StaticPath, 'out.html'), 'utf-8')
    );

    await serve(port, async (req, ctx) => {
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

        // static files in the ninety output folder
        const staticRes = await tryServeFile(pathMod.join(__dirname, StaticPath, path));
        if (staticRes) return staticRes;

        // project-level static/ directory
        const projectStaticPath = pathMod.resolve(process.cwd(), 'static');
        if (path === '/' || path === '') {
            const indexRes = await tryServeFile(pathMod.join(projectStaticPath, 'index.html'));
            if (indexRes) return indexRes;
        }
        const projectRes = await tryServeFile(pathMod.join(projectStaticPath, path));
        if (projectRes) return projectRes;

        const ssrComponentPath = pathMod.join(__dirname, HadarsFolder, SSR_FILENAME);
        // Use a file: URL so the ?t= suffix is treated as a URL query string
        // (cache-busting key) rather than a literal filename character on Linux.
        const importPath = pathToFileURL(ssrComponentPath).href + `?t=${ssrBuildId}`;

        const {
            default: Component,
            getInitProps,
            getAfterRenderProps,
            getFinalProps,
        } = (await import(importPath)) as HadarsEntryModule<any>;

        const { ReactPage, status, headHtml } = await getReactResponse(request, {
            document: {
                body: Component as React.FC<HadarsProps<object>>,
                lang: 'en',
                getInitProps,
                getAfterRenderProps,
                getFinalProps,
            },
        });

        return buildSsrResponse(ReactPage, headHtml, status, getPrecontentHtml, options.streaming === true); // no pool in dev
    }, options.websocket);
};

export const build = async (options: HadarsRuntimeOptions) => {
    validateOptions(options);

    const entry = pathMod.resolve(__dirname, options.entry);

    // prepare client script
    const packageDir = pathMod.dirname(fileURLToPath(import.meta.url));
    const clientScriptPath = pathMod.resolve(packageDir, 'utils', 'clientScript.js');
    const headPath = pathMod.resolve(packageDir, 'utils', 'Head');
    let clientScript = '';
    try {
        clientScript = (await fs.readFile(clientScriptPath, 'utf-8'))
            .replace('$_MOD_PATH$', entry + getSuffix(options.mode))
            .replace('$_HEAD_PATH$', headPath);
    } catch (err) {
        const srcClientPath = pathMod.resolve(packageDir, 'utils', 'clientScript.tsx');
        clientScript = (await fs.readFile(srcClientPath, 'utf-8'))
            .replace('$_MOD_PATH$', entry + `?v=${Date.now()}`)
            .replace('$_HEAD_PATH$', pathMod.resolve(packageDir, 'utils', 'Head'));
    }

    const tmpFilePath = pathMod.join(os.tmpdir(), `hadars-client-${Date.now()}.tsx`);
    await fs.writeFile(tmpFilePath, clientScript);

    const randomStr = crypto.randomBytes(6).toString('hex');

    // Compile client and SSR bundles in parallel — they write to different
    // output directories and use different entry files, so they are fully
    // independent and safe to run concurrently.
    console.log("Building client and server bundles in parallel...");
    await Promise.all([
        compileEntry(tmpFilePath, {
            target: 'web',
            output: {
                filename: `index-${randomStr}.js`,
                path: pathMod.resolve(__dirname, StaticPath),
            },
            base: options.baseURL,
            mode: 'production',
            swcPlugins: options.swcPlugins,
            define: options.define,
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
        }),
    ]);
    await fs.rm(tmpFilePath);

    await fs.writeFile(
        pathMod.join(__dirname, HadarsFolder, 'hadars.json'),
        JSON.stringify({ buildId: randomStr }),
    );
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
        const workerTs = pathMod.resolve(packageDir, 'src', 'ssr-render-worker.ts');
        const workerFile = existsSync(workerJs) ? workerJs : workerTs;
        const ssrBundlePath = pathMod.resolve(__dirname, HadarsFolder, SSR_FILENAME);
        renderPool = new RenderWorkerPool(workerFile, workers, ssrBundlePath);
        console.log(`[hadars] SSR render pool: ${workers} worker threads`);
    }

    const getPrecontentHtml = makePrecontentHtmlGetter(
        fs.readFile(pathMod.join(__dirname, StaticPath, 'out.html'), 'utf-8')
    );

    await serve(port, async (req, ctx) => {
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

        // static files in the ninety output folder
        const staticRes = await tryServeFile(pathMod.join(__dirname, StaticPath, path));
        if (staticRes) return staticRes;

        if (path === '/' || path === '') {
            const indexRes = await tryServeFile(pathMod.join(__dirname, StaticPath, 'index.html'));
            if (indexRes) return indexRes;
        }

        // project-level static/ directory
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
        const {
            default: Component,
            getInitProps,
            getAfterRenderProps,
            getFinalProps,
        } = (await import(componentPath)) as HadarsEntryModule<any>;

        const { ReactPage, status, headHtml, renderPayload } = await getReactResponse(request, {
            document: {
                body: Component as React.FC<HadarsProps<object>>,
                lang: 'en',
                getInitProps,
                getAfterRenderProps,
                getFinalProps,
            },
        });

        return buildSsrResponse(ReactPage, headHtml, status, getPrecontentHtml, options.streaming === true, renderPool, renderPayload);
    }, options.websocket);
};
