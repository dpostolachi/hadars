import { parseRequest } from './request';
import { buildHeadHtml } from './response';
import type { AppHead, HadarsOptions } from '../types/hadars';

export const HEAD_MARKER = '<meta name="HADARS_HEAD">';
export const BODY_MARKER = '<meta name="HADARS_BODY">';

const encoder = new TextEncoder();

// ── HTML response assembly ────────────────────────────────────────────────────

export function buildSsrResponse(
    head: AppHead,
    status: number,
    getAppBody: () => Promise<string>,
    finalize: () => Promise<{ clientProps: Record<string, unknown> }>,
    getPrecontentHtml: (headHtml: string) => [string, string] | Promise<[string, string]>,
): Response {
    const headHtml = buildHeadHtml(head);
    const precontentResult = getPrecontentHtml(headHtml);

    const responseStream = new ReadableStream({
        async start(controller) {
            try {
                // Resolve the template — sync on the hot path (every request after the first).
                const [precontentHtml, postContent] = precontentResult instanceof Promise
                    ? await precontentResult
                    : precontentResult;

                // Chunk 1 — flush the full <head> shell immediately so the browser
                // can start loading CSS / fonts / preload hints before the body arrives.
                controller.enqueue(encoder.encode(precontentHtml));

                // Chunk 2 — body HTML. getAppBody() triggers the actual renderToString
                // now that head has been flushed. All data is cached from the preflight
                // so this pass is fast (no async waits).
                const bodyHtml = await getAppBody();
                controller.enqueue(encoder.encode(`<div id="app">${bodyHtml}</div>`));

                // Chunk 3 — JSON props script + post-content. Separated so the browser
                // can parse/render the body while getFinalProps is still completing.
                const { clientProps } = await finalize();
                const scriptContent = JSON.stringify({ hadars: { props: clientProps } }).replace(/</g, '\\u003c');
                controller.enqueue(encoder.encode(
                    `<script id="hadars" type="application/json">${scriptContent}</script>` +
                    postContent,
                ));
                controller.close();
            } catch (err) {
                // Head chunk may already be sent; signal a stream error so the
                // connection is closed cleanly rather than hanging.
                controller.error(err);
            }
        },
    });
    return new Response(responseStream, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status,
    });
}

/**
 * Like {@link buildSsrResponse} but returns the complete HTML string directly
 * instead of wrapping it in a streaming Response. Use this in environments
 * where streaming is not beneficial (e.g. AWS Lambda) to avoid the
 * ReadableStream allocation and the subsequent `.text()` drain overhead.
 */
export async function buildSsrHtml(
    bodyHtml: string,
    clientProps: Record<string, unknown>,
    headHtml: string,
    getPrecontentHtml: (headHtml: string) => [string, string] | Promise<[string, string]>,
): Promise<string> {
    const [precontentHtml, postContent] = await Promise.resolve(getPrecontentHtml(headHtml));
    const scriptContent = JSON.stringify({ hadars: { props: clientProps } }).replace(/</g, '\\u003c');
    return (
        precontentHtml +
        `<div id="app">${bodyHtml}</div><script id="hadars" type="application/json">${scriptContent}</script>` +
        postContent
    );
}

/**
 * Returns a function that parses `out.html` into pre-head, post-head, and
 * post-content segments and caches the result. Call the returned function with
 * the per-request headHtml to produce the full HTML prefix and suffix.
 */
export const makePrecontentHtmlGetter = (htmlFilePromise: Promise<string>) => {
    let preHead: string | null = null;
    let postHead: string | null = null;
    let postContent: string | null = null;
    // Returns synchronously once the template has been loaded and parsed
    // (every request after the first).  Callers can check `instanceof Promise`
    // to take a zero-await hot path.
    return (headHtml: string): [string, string] | Promise<[string, string]> => {
        if (preHead !== null) {
            // Hot path — sync return, no Promise allocation.
            return [preHead + headHtml + postHead!, postContent!];
        }
        return htmlFilePromise.then(html => {
            const headEnd = html.indexOf(HEAD_MARKER);
            const contentStart = html.indexOf(BODY_MARKER);
            preHead = html.slice(0, headEnd);
            postHead = html.slice(headEnd + HEAD_MARKER.length, contentStart);
            postContent = html.slice(contentStart + BODY_MARKER.length);
            return [preHead + headHtml + postHead, postContent];
        });
    };
};

// ── SSR response cache ────────────────────────────────────────────────────────

export interface CacheEntry {
    /** Gzip-compressed response body. */
    body: Uint8Array;
    status: number;
    /** Headers with Content-Encoding: gzip already set. */
    headers: [string, string][];
    expiresAt: number | null;
}

export type CacheFetchHandler = (req: Request, ctx: any) => Promise<Response | undefined>;

async function transformStream(
    data: Uint8Array,
    stream: { writable: WritableStream; readable: ReadableStream<Uint8Array> },
): Promise<Uint8Array> {
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

// Use the Web Streams CompressionStream when available (Bun, Deno, Node ≥ 18).
// Fall back to node:zlib on older Node versions.
async function zlibGzip(d: Uint8Array): Promise<Uint8Array> {
    const zlib = await import('node:zlib');
    const { promisify } = await import('node:util');
    return promisify(zlib.gzip)(d) as Promise<Uint8Array>;
}
async function zlibGunzip(d: Uint8Array): Promise<Uint8Array> {
    const zlib = await import('node:zlib');
    const { promisify } = await import('node:util');
    return promisify(zlib.gunzip)(d) as Promise<Uint8Array>;
}

export const gzipCompress = (d: Uint8Array): Promise<Uint8Array> =>
    (globalThis as any).CompressionStream
        ? transformStream(d, new (globalThis as any).CompressionStream('gzip'))
        : zlibGzip(d);

export const gzipDecompress = (d: Uint8Array): Promise<Uint8Array> =>
    (globalThis as any).DecompressionStream
        ? transformStream(d, new (globalThis as any).DecompressionStream('gzip'))
        : zlibGunzip(d);

export async function buildCacheEntry(res: Response, ttl: number | undefined): Promise<CacheEntry> {
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

export async function serveFromEntry(entry: CacheEntry, req: Request): Promise<Response> {
    const accept = req.headers.get('Accept-Encoding') ?? '';
    if (accept.includes('gzip')) {
        return new Response(entry.body.buffer as ArrayBuffer, { status: entry.status, headers: entry.headers });
    }
    const plain = await gzipDecompress(entry.body);
    const headers = entry.headers.filter(([k]) => k.toLowerCase() !== 'content-encoding');
    return new Response(plain.buffer as ArrayBuffer, { status: entry.status, headers });
}

export function createRenderCache(
    opts: NonNullable<HadarsOptions['cache']>,
    handler: CacheFetchHandler,
): CacheFetchHandler {
    const store    = new Map<string, CacheEntry>();
    const inFlight = new Map<string, Promise<CacheEntry | null>>();

    return async (req, ctx) => {
        const hadarsReq = parseRequest(req);
        const cacheOpts = await opts(hadarsReq);
        const key = cacheOpts?.key ?? null;

        if (key != null) {
            const entry = store.get(key);
            if (entry) {
                const expired = entry.expiresAt != null && Date.now() >= entry.expiresAt;
                if (!expired) return serveFromEntry(entry, req);
                store.delete(key);
            }

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
        }

        return handler(req, ctx);
    };
}
