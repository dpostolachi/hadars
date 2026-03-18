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
import { processSegmentCache } from './utils/segmentCache';
import { renderToString, createElement } from './slim-react/index';

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

// ── Head HTML serialisation ────────────────────────────────────────────────

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escAttr = (s: string) => s.replace(/[&<>"]/g, c => ESC[c] ?? c);
const escText = (s: string) => s.replace(/[&<>]/g, c => ESC[c] ?? c);

const HEAD_ATTR: Record<string, string> = {
    className: 'class', htmlFor: 'for', httpEquiv: 'http-equiv',
    charSet: 'charset', crossOrigin: 'crossorigin',
};

function renderHeadTag(tag: string, id: string, opts: Record<string, unknown>, selfClose = false): string {
    let a = ` id="${escAttr(id)}"`;
    let inner = '';
    for (const [k, v] of Object.entries(opts)) {
        if (k === 'key' || k === 'children') continue;
        if (k === 'dangerouslySetInnerHTML') { inner = (v as any).__html ?? ''; continue; }
        const attr = HEAD_ATTR[k] ?? k;
        if (v === true) a += ` ${attr}`;
        else if (v !== false && v != null) a += ` ${attr}="${escAttr(String(v))}"`;
    }
    return selfClose ? `<${tag}${a}>` : `<${tag}${a}>${inner}</${tag}>`;
}

function buildHeadHtml(head: any): string {
    let html = `<title>${escText(head.title ?? '')}</title>`;
    for (const [id, opts] of Object.entries(head.meta ?? {}))
        html += renderHeadTag('meta', id, opts as Record<string, unknown>, true);
    for (const [id, opts] of Object.entries(head.link ?? {}))
        html += renderHeadTag('link', id, opts as Record<string, unknown>, true);
    for (const [id, opts] of Object.entries(head.style ?? {}))
        html += renderHeadTag('style', id, opts as Record<string, unknown>);
    for (const [id, opts] of Object.entries(head.script ?? {}))
        html += renderHeadTag('script', id, opts as Record<string, unknown>);
    return html;
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

    try {
        // First render: populates the useServerData cache via suspend/retry.
        await renderToString(createElement(Component, props));
    } catch (e) {
        (globalThis as any).__hadarsUnsuspend = null;
        throw e;
    }

    const { context: _ctx, ...restProps } = getFinalProps ? await getFinalProps(props) : props;

    // Collect fulfilled useServerData values for client-side hydration.
    const serverData: Record<string, unknown> = {};
    for (const [key, entry] of unsuspend.cache) {
        if (entry.status === 'fulfilled') serverData[key] = entry.value;
    }
    const clientProps = {
        ...restProps,
        location: serialReq.location,
        ...(Object.keys(serverData).length > 0 ? { __serverData: serverData } : {}),
    };

    const finalAppProps = { ...props, location: serialReq.location, context };

    // Final render — __hadarsUnsuspend is still set; cache is fully populated so
    // useServerData calls return cached values without any async work.
    let appHtml: string;
    try {
        appHtml = await renderToString(createElement(Component, finalAppProps));
    } finally {
        (globalThis as any).__hadarsUnsuspend = null;
    }
    appHtml = processSegmentCache(appHtml);

    const scriptContent = JSON.stringify({ hadars: { props: clientProps } }).replace(/</g, '\\u003c');
    const html = `<div id="app">${appHtml}</div><script id="hadars" type="application/json">${scriptContent}</script>`;

    return { html, headHtml: buildHeadHtml(context.head), status: context.head.status ?? 200 };
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
