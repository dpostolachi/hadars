/** Wrap outside the adapter so probes precede all hooks, proxies and caches. */
export function splitHandler(handler: (request: Request) => Promise<Response>, identity: { release: string; group: string; shell: string }) {
    return async (request: Request): Promise<Response> => {
        const response = request.method === 'GET' && new URL(request.url).pathname === '/__hadars/release'
            ? new Response(JSON.stringify(identity), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
            : await handler(request);
        const headers = new Headers(response.headers);
        headers.set('x-hadars-release', identity.release);
        headers.set('x-hadars-group', identity.group);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
}
