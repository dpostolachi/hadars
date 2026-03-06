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

                const hasBody = !['GET', 'HEAD'].includes(req.method);
                const proxyReq = new Request(targetURL.toString(), {
                    method: req.method,
                    headers: sendHeaders,
                    body: hasBody ? req.body : undefined,
                    redirect: 'follow',
                    // Node.js (undici) requires duplex:'half' when body is a ReadableStream
                    ...(hasBody ? { duplex: 'half' } : {}),
                } as RequestInit);

                const res = await fetch(proxyReq);
                // Read the response body
                const body = await res.arrayBuffer();
                // remove content-length and content-encoding headers to avoid issues with modified body
                const clonedRes = new Headers(res.headers);
                clonedRes.delete('content-length');
                clonedRes.delete('content-encoding');
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