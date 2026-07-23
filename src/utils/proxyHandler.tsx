import type { HadarsOptions, HadarsRequest } from "../types/hadars";

type ProxyHandler = (req: HadarsRequest) => ( Promise<Response | undefined> | undefined );

const cloneHeaders = (headers: Headers) => {
    return new Headers(headers);
};

const getCORSHeaders = (req: HadarsRequest) => {
    const origin = req.headers.get('Origin') || '*';
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
        'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') || '*',
        'Access-Control-Allow-Credentials': 'true',
    };
};

export const createProxyHandler = (options: HadarsOptions): ProxyHandler => {

    const { proxy, proxyCORS } = options;

    if (!proxy) {
        return () => undefined;
    }

    if (typeof proxy === 'function') {
        return async (req: HadarsRequest) => {
            if (req.method === 'OPTIONS' && options.proxyCORS) {
                return new Response(null, {
                    status: 204,
                    headers: getCORSHeaders(req),
                });
            }
            const res = await proxy(req);
            if (res && proxyCORS) {
                // Clone the response to modify headers
                const modifiedHeaders = new Headers(res.headers);
                Object.entries(getCORSHeaders(req)).forEach(([key, value]) => {
                    modifiedHeaders.set(key, value);
                });
                return new Response(res.body, {
                    status: res.status,
                    statusText: res.statusText,
                    headers: modifiedHeaders,
                });
            }
            return res || undefined;
        };
    }

    // sort proxy rules by length of path (longest first)
    const proxyRules = Object.entries(proxy).sort((a, b) => b[0].length - a[0].length);

    return async (req: HadarsRequest) => {
        for (const [path, target] of proxyRules) {
            if (req.pathname.startsWith(path)) {
                if (req.method === 'OPTIONS' && proxyCORS) {
                    return new Response(null, {
                        status: 204,
                        headers: getCORSHeaders(req),
                    });
                }
                const targetURL = new URL(target);
                targetURL.pathname = targetURL.pathname.replace(/\/$/, '') + req.pathname.slice(path.length);
                targetURL.search = req.search;

                const sendHeaders = cloneHeaders(req.headers);
                // Overwrite the Host header to match the target
                sendHeaders.set('Host', targetURL.host);
                // Force an Accept-Encoding the runtime's fetch() can actually
                // transparently decompress. If left as-is, the client's header (or
                // the runtime's own default) may advertise algorithms like `zstd`
                // that undici (Node/Bun) does not decode — the upstream then
                // legitimately responds with e.g. `content-encoding: zstd`, but
                // res.arrayBuffer() below returns the still-compressed bytes,
                // which we then forward as if they were plain text.
                sendHeaders.set('Accept-Encoding', 'gzip, deflate, br');

                const hasBody = !['GET', 'HEAD'].includes(req.method);
                const proxyReq = new Request(targetURL.toString(), {
                    method: req.method,
                    headers: sendHeaders,
                    body: hasBody ? req.body : undefined,
                    redirect: 'manual',
                    // Node.js (undici) requires duplex:'half' when body is a ReadableStream
                    ...(hasBody ? { duplex: 'half' } : {}),
                } as RequestInit);

                const res = await fetch(proxyReq);
                // Read the response body — fetch() transparently decompresses it
                // if the upstream sent a Content-Encoding, but leaves the response
                // headers unchanged (undici does not rewrite them to match).
                const body = await res.arrayBuffer();
                // The forwarded body is a single fully-buffered ArrayBuffer, so any
                // header describing the *original* upstream transfer/encoding no
                // longer matches it and must be stripped:
                //  - content-length: original was the compressed size.
                //  - content-encoding: body has already been decompressed above.
                //  - transfer-encoding: body is no longer chunked once buffered;
                //    forwarding "chunked" here produces an invalid response that
                //    downstream HTTP clients may hang on or fail to parse.
                const clonedRes = new Headers(res.headers);
                clonedRes.delete('content-length');
                clonedRes.delete('content-encoding');
                clonedRes.delete('transfer-encoding');
                if (proxyCORS) {
                    Object.entries(getCORSHeaders(req)).forEach(([key, value]) => {
                        clonedRes.set(key, value);
                    });
                }
                // return a new Response with the modified headers and original body
                return new Response(body, {
                    status: res.status,
                    statusText: res.statusText,
                    headers: clonedRes,
                });
            }
        }
        return undefined;
    };
}