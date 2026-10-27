export interface SplitIdentity { release: string; group: string; shell: string }

/** Inject into the first HTML prefix without buffering the rendered body. */
function releaseDocument(response: Response, identity: SplitIdentity): Response {
    if (!response.body || !/^text\/html\b/i.test(response.headers.get('content-type') ?? '')) return response;
    // Keep the public-env executable JSON discipline without adding a shared
    // build dependency: ordinary export chunk ordering must remain unchanged.
    const json = JSON.stringify({ release: identity.release, group: identity.group })
        .replace(/[<\u2028\u2029]/g, char => char === '<' ? '\\u003c' : char === '\u2028' ? '\\u2028' : '\\u2029');
    const script = `<script>globalThis.__HADARS_RELEASE__ = ${json}</script>`;
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let prefix = '';
    let injected = false;
    const compressed = response.headers.get('content-encoding') === 'gzip';
    const input = compressed ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
    const body = input.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            if (injected) { controller.enqueue(encoder.encode(decoder.decode(chunk, { stream: true }))); return; }
            prefix += decoder.decode(chunk, { stream: true });
            // Insert before every application/entry script, even with a custom template.
            const head = /<head\b[^>]*>/i.exec(prefix);
            const firstScript = /<script\b/i.exec(prefix);
            const index = head && (!firstScript || head.index < firstScript.index) ? head.index + head[0].length : firstScript?.index;
            if (index === undefined) return;
            controller.enqueue(encoder.encode(prefix.slice(0, index) + script + prefix.slice(index)));
            injected = true;
        },
        flush(controller) {
            controller.enqueue(encoder.encode((injected ? '' : script + prefix) + decoder.decode()));
        },
    }));
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    if (compressed) headers.delete('content-encoding');
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/** Wrap outside the adapter so probes and assertions precede every application action. */
export function splitHandler(handler: (request: Request) => Promise<Response>, identity: SplitIdentity) {
    return async (request: Request): Promise<Response> => {
        const selector = request.headers.get('x-hadars-release-selector');
        const json = (value: unknown, status: number) => new Response(JSON.stringify(value), {
            status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        });
        let response: Response;
        if (request.method === 'GET' && new URL(request.url).pathname === '/__hadars/release') {
            response = json(identity, 200);
        } else if (selector !== null && !/^[0-9a-f]{16}$/.test(selector)) {
            response = json({ error: 'SPLIT_RELEASE_SELECTOR_INVALID' }, 400);
        } else if (selector !== null && selector !== identity.release) {
            response = json({ error: 'SPLIT_RELEASE_MISMATCH', expected: identity.release, received: selector, group: identity.group }, 409);
        } else {
            response = releaseDocument(await handler(request), identity);
        }
        const headers = new Headers(response.headers);
        headers.set('x-hadars-release', identity.release);
        headers.set('x-hadars-group', identity.group);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
}
