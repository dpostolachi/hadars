/**
 * What the `fetch` option may return:
 * - a `Response`: sent as-is; SSR and the proxy are skipped;
 * - a `Headers` instance: SSR continues, and these headers are added to the SSR response only
 *   (not to proxied responses or to responses the fetch handler returns);
 * - `undefined`: nothing to do, SSR continues.
 */
export type FetchResult = Response | Headers | undefined;

let warnedUnapplied = false;

export function splitFetchResult(result: FetchResult): { response?: Response; ssrHeaders?: Headers } {
    if (result instanceof Response) return { response: result };
    if (result instanceof Headers) return { ssrHeaders: result };
    return {};
}

/** Adapters that do not apply a `Headers` result yet call this so the omission is visible once. */
export function noteUnappliedSsrHeaders(): void {
    if (warnedUnapplied) return;
    warnedUnapplied = true;
    console.warn('[hadars] fetch returned headers for SSR responses; this adapter does not apply them yet (Bunny Edge Scripting does).');
}

export function withSsrHeaders(response: Response, headers: Headers | undefined): Response {
    if (!headers) return response;
    const merged = new Headers(response.headers);
    headers.forEach((value, name) => merged.set(name, value));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
}
