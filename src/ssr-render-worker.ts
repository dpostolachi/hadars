/**
 * SSR render worker — runs in a node:worker_threads thread.
 *
 * Uses slim-react (bundled with hadars) for rendering instead of react-dom/server.
 * The SSR bundle is compiled with `react` aliased to slim-react, so both the
 * worker and the bundle share the same slim-react instance (and its globalThis
 * render state) without any extra coordination.
 *
 * Message: { type: 'renderFull', id, request: SerializableRequest }
 * Reply:   { id, html, headHtml, status }  |  { id, error }
 */

import { workerData, parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { renderToString, createElement } from './slim-react/index';
import { buildHeadHtml } from './utils/response';

const { ssrBundlePath } = workerData as { ssrBundlePath: string };

let _ssrMod: any = null;

async function init() {
    if (_ssrMod) return;
    _ssrMod = await import(pathToFileURL(ssrBundlePath).href);
}

export type SerializableRequest = {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Uint8Array | null;
    pathname: string;
    search: string;
    location: string;
    cookies: Record<string, string>;
};

function deserializeRequest(s: SerializableRequest): any {
    const init: RequestInit = { method: s.method, headers: new Headers(s.headers) };
    if (s.body) init.body = s.body.buffer as ArrayBuffer;
    const req = new Request(s.url, init);
    Object.assign(req, { pathname: s.pathname, search: s.search, location: s.location, cookies: s.cookies });
    return req;
}

// ── Full lifecycle ─────────────────────────────────────────────────────────

async function runFullLifecycle(serialReq: SerializableRequest) {
    const Component = _ssrMod.default;
    const { getInitProps, getFinalProps } = _ssrMod;

    const parsedReq = deserializeRequest(serialReq);

    const context: any = {
        head: { title: 'Hadars App', meta: {}, link: {}, style: {}, script: {}, status: 200 },
    };

    let props: any = {
        ...(getInitProps ? await getInitProps(parsedReq) : {}),
        location: serialReq.location,
        context,
    };

    // Create per-request cache for useServerData, active for all renders.
    const unsuspend = { cache: new Map<string, any>() };
    (globalThis as any).__hadarsUnsuspend = unsuspend;

    // Single pass — component-level self-retry resolves all useServerData inline.
    // context.head is fully populated by the time renderToString returns.
    let appHtml: string;
    try {
        appHtml = await renderToString(createElement(Component, props));
    } finally {
        (globalThis as any).__hadarsUnsuspend = null;
    }
    // Head is captured after the render — all components have run.
    const headHtml = buildHeadHtml(context.head);
    const status = context.head.status ?? 200;
    const { context: _ctx, ...restProps } = getFinalProps ? await getFinalProps(props) : props;

    // Collect fulfilled useServerData values for client-side hydration.
    const serverData: Record<string, unknown> = {};
    let hasServerData = false;
    for (const [key, entry] of unsuspend.cache) {
        if (entry.status === 'fulfilled') { serverData[key] = entry.value; hasServerData = true; }
    }
    const clientProps = {
        ...restProps,
        location: serialReq.location,
        ...(hasServerData ? { __serverData: serverData } : {}),
    };

    const scriptContent = JSON.stringify({ hadars: { props: clientProps } }).replace(/</g, '\\u003c');
    const html = `<div id="app">${appHtml}</div><script id="hadars" type="application/json">${scriptContent}</script>`;

    return { html, headHtml, status };
}

// ── Message handler ────────────────────────────────────────────────────────

parentPort!.on('message', async (msg: any) => {
    const { id, type, request } = msg;
    try {
        await init();
        if (type !== 'renderFull') return;

        const { html, headHtml, status } = await runFullLifecycle(request as SerializableRequest);
        parentPort!.postMessage({ id, html, headHtml, status });

    } catch (err: any) {
        parentPort!.postMessage({ id, error: err?.message ?? String(err) });
    }
});
