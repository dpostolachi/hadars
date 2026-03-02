/**
 * SSR render worker — runs in a node:worker_threads thread.
 *
 * Handles one message type sent by RenderWorkerPool in build.ts:
 *
 *   { type: 'renderFull', id, streaming: false, request: SerializableRequest }
 *     → runs full lifecycle (getInitProps → render loop → getAfterRenderProps → getFinalProps)
 *     → renderToString(ReactPage)
 *     → postMessage({ id, html, headHtml, status })
 *
 *   { type: 'renderFull', id, streaming: true, request: SerializableRequest }
 *     → runs full lifecycle
 *     → renderToReadableStream(ReactPage), streams chunks back
 *     → postMessage({ id, type: 'head', headHtml, status })
 *     → postMessage({ id, type: 'chunk', chunk }) × N
 *     → postMessage({ id, type: 'done' })
 *
 * The SSR bundle path is passed once via workerData at thread creation time so
 * the SSR module is only imported once per worker lifetime.
 */

import { workerData, parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import pathMod from 'node:path';
import { pathToFileURL } from 'node:url';

const { ssrBundlePath } = workerData as { ssrBundlePath: string };

// Lazy-loaded singletons resolved from the *project's* node_modules so the
// same React instance is shared with the SSR bundle (prevents invalid hook calls).
let _React: any = null;
let _renderToStaticMarkup: ((element: any) => string) | null = null;
let _renderToString: ((element: any) => string) | null = null;
let _renderToReadableStream: ((element: any, options?: any) => Promise<ReadableStream<Uint8Array>>) | null = null;
// Full SSR module — includes default (App component) + lifecycle exports.
let _ssrMod: any = null;

async function init() {
    if (_React && _ssrMod) return;

    const req = createRequire(pathMod.resolve(process.cwd(), '__ninety_fake__.js'));

    if (!_React) {
        const reactPath = pathToFileURL(req.resolve('react')).href;
        const reactMod = await import(reactPath);
        _React = reactMod.default ?? reactMod;
    }

    if (!_renderToString || !_renderToStaticMarkup) {
        const serverPath = pathToFileURL(req.resolve('react-dom/server')).href;
        const serverMod = await import(serverPath);
        _renderToString = serverMod.renderToString;
        _renderToStaticMarkup = serverMod.renderToStaticMarkup;
    }

    if (!_renderToReadableStream) {
        const browserPath = pathToFileURL(req.resolve('react-dom/server.browser')).href;
        const browserMod = await import(browserPath);
        _renderToReadableStream = browserMod.renderToReadableStream;
    }

    if (!_ssrMod) {
        _ssrMod = await import(pathToFileURL(ssrBundlePath).href);
    }
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
    if (s.body) init.body = s.body;
    const req = new Request(s.url, init);
    Object.assign(req, {
        pathname: s.pathname,
        search: s.search,
        location: s.location,
        cookies: s.cookies,
    });
    return req;
}

function buildHeadHtml(head: any): string {
    const R = _React;
    const metaEntries = Object.entries(head.meta ?? {});
    const linkEntries = Object.entries(head.link ?? {});
    const styleEntries = Object.entries(head.style ?? {});
    const scriptEntries = Object.entries(head.script ?? {});
    return _renderToStaticMarkup!(
        R.createElement(R.Fragment, null,
            R.createElement('title', null, head.title),
            ...metaEntries.map(([id, opts]) => R.createElement('meta', { key: id, id, ...(opts as any) })),
            ...linkEntries.map(([id, opts]) => R.createElement('link', { key: id, id, ...(opts as any) })),
            ...styleEntries.map(([id, opts]) => R.createElement('style', { key: id, id, ...(opts as any) })),
            ...scriptEntries.map(([id, opts]) => R.createElement('script', { key: id, id, ...(opts as any) })),
        )
    );
}

function buildReactPage(appProps: any, clientProps: any) {
    const R = _React;
    const Component = _ssrMod.default;
    return R.createElement(
        R.Fragment, null,
        R.createElement('div', { id: 'app' },
            R.createElement(Component, appProps),
        ),
        R.createElement('script', {
            id: 'hadars',
            type: 'application/json',
            dangerouslySetInnerHTML: {
                __html: JSON.stringify({ hadars: { props: clientProps } }).replace(/</g, '\\u003c'),
            },
        }),
    );
}

async function runFullLifecycle(serialReq: SerializableRequest) {
    const R = _React;
    const Component = _ssrMod.default;
    const { getInitProps, getAfterRenderProps, getFinalProps } = _ssrMod;

    const parsedReq = deserializeRequest(serialReq);

    const unsuspend: any = { cache: new Map(), hasPending: false };
    const context: any = {
        head: { title: 'Hadars App', meta: {}, link: {}, style: {}, script: {}, status: 200 },
        _unsuspend: unsuspend,
    };

    let props: any = {
        ...(getInitProps ? await getInitProps(parsedReq) : {}),
        location: serialReq.location,
        context,
    };

    // useServerData render loop — same logic as getReactResponse on main thread.
    let html = '';
    let iters = 0;
    do {
        unsuspend.hasPending = false;
        try {
            (globalThis as any).__hadarsUnsuspend = unsuspend;
            html = _renderToStaticMarkup!(R.createElement(Component, props));
        } finally {
            (globalThis as any).__hadarsUnsuspend = null;
        }
        if (unsuspend.hasPending) {
            const pending = [...unsuspend.cache.values()]
                .filter((e: any) => e.status === 'pending')
                .map((e: any) => e.promise);
            await Promise.all(pending);
        }
    } while (unsuspend.hasPending && ++iters < 25);

    props = getAfterRenderProps ? await getAfterRenderProps(props, html) : props;

    // Re-render to capture head changes from getAfterRenderProps.
    try {
        (globalThis as any).__hadarsUnsuspend = unsuspend;
        _renderToStaticMarkup!(R.createElement(Component, { ...props, location: serialReq.location, context }));
    } finally {
        (globalThis as any).__hadarsUnsuspend = null;
    }

    // Collect resolved useServerData values for client hydration.
    const serverData: Record<string, unknown> = {};
    for (const [k, v] of unsuspend.cache) {
        if ((v as any).status === 'fulfilled') serverData[k] = (v as any).value;
        if ((v as any).status === 'suspense-cached') serverData[k] = (v as any).value;
    }

    const { context: _ctx, ...restProps } = getFinalProps ? await getFinalProps(props) : props;
    const clientProps = {
        ...restProps,
        location: serialReq.location,
        ...(Object.keys(serverData).length > 0 ? { __serverData: serverData } : {}),
    };

    const headHtml = buildHeadHtml(context.head);
    const status: number = context.head.status ?? 200;
    const finalAppProps = { ...props, location: serialReq.location, context };

    return { finalAppProps, clientProps, headHtml, status, unsuspend };
}

parentPort!.on('message', async (msg: any) => {
    const { id, type, request, streaming } = msg;
    try {
        await init();

        if (type !== 'renderFull') return;

        const { finalAppProps, clientProps, headHtml, status, unsuspend } =
            await runFullLifecycle(request as SerializableRequest);

        const ReactPage = buildReactPage(finalAppProps, clientProps);

        if (streaming) {
            parentPort!.postMessage({ id, type: 'head', headHtml, status });
            let streamPromise: Promise<ReadableStream<Uint8Array>>;
            try {
                (globalThis as any).__hadarsUnsuspend = unsuspend;
                streamPromise = _renderToReadableStream!(ReactPage);
            } finally {
                (globalThis as any).__hadarsUnsuspend = null;
            }
            const stream = await streamPromise;
            const reader = stream.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                parentPort!.postMessage({ id, type: 'chunk', chunk: value }, [value.buffer as ArrayBuffer]);
            }
            parentPort!.postMessage({ id, type: 'done' });
        } else {
            let html: string;
            try {
                (globalThis as any).__hadarsUnsuspend = unsuspend;
                html = _renderToString!(ReactPage);
            } finally {
                (globalThis as any).__hadarsUnsuspend = null;
            }
            parentPort!.postMessage({ id, html, headHtml, status });
        }

    } catch (err: any) {
        (globalThis as any).__hadarsUnsuspend = null;
        const errMsg = err?.message ?? String(err);
        if (streaming) {
            parentPort!.postMessage({ id, type: 'error', error: errMsg });
        } else {
            parentPort!.postMessage({ id, error: errMsg });
        }
    }
});
