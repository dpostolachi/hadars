import { isBun, isDeno } from './runtime';

/**
 * Minimal server context passed to every fetch handler invocation.
 * On Bun, `upgrade` performs a real WebSocket upgrade.
 * On all other runtimes it is a no-op that always returns false.
 */
export interface ServerContext {
    upgrade(req: Request): boolean;
}

type FetchHandler = (
    req: Request,
    ctx: ServerContext,
) => Promise<Response | undefined> | Response | undefined;

/** Converts a Node.js Readable stream to a Web ReadableStream<Uint8Array>. */
function nodeReadableToWebStream(readable: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        start(controller) {
            readable.on('data', (chunk: Buffer | string) => {
                controller.enqueue(
                    typeof chunk === 'string'
                        ? enc.encode(chunk)
                        : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
                );
            });
            readable.on('end', () => controller.close());
            readable.on('error', (err) => controller.error(err));
        },
        cancel() {
            (readable as any).destroy?.();
        },
    });
}

const noopCtx: ServerContext = { upgrade: () => false };

/**
 * Starts an HTTP server on the given port using the best available runtime API:
 * - **Bun**:    `Bun.serve()` — full WebSocket support via the `websocket` option
 * - **Deno**:   `Deno.serve()`
 * - **Node.js**: `node:http` `createServer()` with a Web-Fetch bridge
 *
 * The `fetchHandler` may return `undefined` to signal that the response was
 * handled out-of-band (e.g. a Bun WebSocket upgrade).
 */
function withRequestLogging(handler: FetchHandler): FetchHandler {
    return async (req, ctx) => {
        const start = performance.now();
        const res = await handler(req, ctx);
        const ms = Math.round(performance.now() - start);
        const status = res?.status ?? 404;
        const path = new URL(req.url).pathname;
        console.log(`[hadars] ${req.method} ${path} ${status} ${ms}ms`);
        return res;
    };
}

const COMPRESSIBLE_RE = /^text\/|\/json|\/javascript|\/xml|\/wasm/;

/**
 * Wraps a handler to apply on-the-fly gzip compression via CompressionStream.
 * Unlike a buffering approach, this pipes the response ReadableStream through
 * a CompressionStream so bytes are compressed and flushed as they arrive —
 * streaming responses remain streaming.
 */
function withCompression(handler: FetchHandler): FetchHandler {
    return async (req, ctx) => {
        const res = await handler(req, ctx);
        if (!res || !res.body) return res;
        const accept = req.headers.get('Accept-Encoding') ?? '';
        if (!accept.includes('gzip')) return res;
        // Skip if already encoded (e.g. pre-compressed cache entry).
        if (res.headers.has('content-encoding')) return res;
        const ct = res.headers.get('content-type') ?? '';
        if (!COMPRESSIBLE_RE.test(ct)) return res;
        if (!(globalThis as any).CompressionStream) return res;
        const compressed = res.body.pipeThrough(
            new (globalThis as any).CompressionStream('gzip'),
        );
        const headers = new Headers(res.headers);
        headers.set('content-encoding', 'gzip');
        headers.delete('content-length'); // length is unknown after compression
        return new Response(compressed, { status: res.status, headers });
    };
}

export async function serve(
    port: number,
    fetchHandler: FetchHandler,
    /** Bun WebSocketHandler — ignored on Deno and Node.js. */
    websocket?: unknown,
): Promise<void> {
    fetchHandler = withCompression(withRequestLogging(fetchHandler));

    // ── Bun ────────────────────────────────────────────────────────────────
    if (isBun) {
        (globalThis as any).Bun.serve({
            port,
            websocket,
            async fetch(req: Request, server: any) {
                const ctx: ServerContext = { upgrade: (r) => server.upgrade(r) };
                // Returning undefined from a Bun fetch handler means the
                // request was handled as a WebSocket upgrade.
                return (await fetchHandler(req, ctx)) ?? undefined;
            },
        });
        return;
    }

    // ── Deno ───────────────────────────────────────────────────────────────
    // Deno 2.x changed the signature to options-first. Use the single-object
    // form { port, handler } which is stable across Deno 1.x and 2.x.
    if (isDeno) {
        (globalThis as any).Deno.serve({
            port,
            handler: async (req: Request) => {
                const res = await fetchHandler(req, noopCtx);
                return res ?? new Response('Not Found', { status: 404 });
            },
        });
        return;
    }

    // ── Node.js ────────────────────────────────────────────────────────────
    const { createServer } = await import('node:http');

    const server = createServer(async (nodeReq, nodeRes) => {
        try {
            // Collect body for non-GET/HEAD requests
            const chunks: Buffer[] = [];
            if (!['GET', 'HEAD'].includes(nodeReq.method ?? 'GET')) {
                for await (const chunk of nodeReq) {
                    chunks.push(chunk as Buffer);
                }
            }
            const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

            const url = `http://localhost:${port}${nodeReq.url ?? '/'}`;
            const reqInit: RequestInit & { duplex?: string } = {
                method: nodeReq.method ?? 'GET',
                headers: new Headers(nodeReq.headers as Record<string, string>),
            };
            if (body) {
                reqInit.body = body;
                reqInit.duplex = 'half';
            }
            const req = new Request(url, reqInit);

            const res = await fetchHandler(req, noopCtx);
            const response = res ?? new Response('Not Found', { status: 404 });

            const headers: Record<string, string> = {};
            response.headers.forEach((v, k) => { headers[k] = v; });
            nodeRes.writeHead(response.status, headers);

            if (response.body) {
                const reader = response.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    await new Promise<void>((resolve, reject) =>
                        nodeRes.write(value, (err) => (err ? reject(err) : resolve())),
                    );
                }
            }
        } catch (err) {
            console.error('[hadars] request error', err);
            if (!nodeRes.headersSent) nodeRes.writeHead(500);
        } finally {
            nodeRes.end();
        }
    });

    await new Promise<void>((resolve, reject) => {
        server.listen(port, () => resolve());
        server.once('error', reject);
    });
}

export { nodeReadableToWebStream };
