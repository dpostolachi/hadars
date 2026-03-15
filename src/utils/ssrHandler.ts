import { parseRequest } from './request';
import type { HadarsOptions } from '../types/hadars';

export const HEAD_MARKER = '<meta name="HADARS_HEAD">';
export const BODY_MARKER = '<meta name="HADARS_BODY">';

const encoder = new TextEncoder();

// ── HTML response assembly ────────────────────────────────────────────────────

export async function buildSsrResponse(
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
                `<div id="app">${bodyHtml}</div><script id="hadars" type="application/json">${scriptContent}</script>` + postContent,
            ));
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
export const makePrecontentHtmlGetter = (htmlFilePromise: Promise<string>) => {
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

export const gzipCompress   = (d: Uint8Array) => transformStream(d, new (globalThis as any).CompressionStream('gzip'));
export const gzipDecompress = (d: Uint8Array) => transformStream(d, new (globalThis as any).DecompressionStream('gzip'));

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
