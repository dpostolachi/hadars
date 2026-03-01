/**
 * SSR render worker — runs in a node:worker_threads thread.
 *
 * Handles three message types sent by RenderWorkerPool in build.ts:
 *
 *   { type: 'staticMarkup', id, props }
 *     → renderToStaticMarkup(_Component, props)
 *     → postMessage({ id, type: 'staticMarkup', html, context: props.context })
 *
 *   { type: 'renderString', id, appProps, clientProps }
 *     → renderToString(ReactPage)
 *     → postMessage({ id, html })
 *
 *   { type: 'renderStream', id, appProps, clientProps }
 *     → renderToReadableStream(ReactPage) — streams chunks back
 *     → postMessage({ id, type: 'chunk', chunk }) × N
 *     → postMessage({ id, type: 'done' })
 *
 * The SSR bundle path is passed once via workerData at thread creation time so
 * the component is only imported once per worker lifetime.
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
let _Component: any = null;

async function init() {
    if (_React && _renderToStaticMarkup && _renderToString && _renderToReadableStream && _Component) return;

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

    if (!_Component) {
        const ssrMod = await import(pathToFileURL(ssrBundlePath).href);
        _Component = ssrMod.default;
    }
}

// Build the full ReactPage element tree — mirrors the shape in response.tsx / build.ts.
// Uses React.createElement to avoid needing a JSX transform in the worker.
function buildReactPage(R: any, appProps: Record<string, unknown>, clientProps: Record<string, unknown>) {
    return R.createElement(
        R.Fragment, null,
        R.createElement('div', { id: 'app' },
            R.createElement(_Component, appProps),
        ),
        R.createElement('script', {
            id: 'hadars',
            type: 'application/json',
            dangerouslySetInnerHTML: {
                __html: JSON.stringify({ hadars: { props: clientProps } }),
            },
        }),
    );
}

parentPort!.on('message', async (msg: any) => {
    const { id, type } = msg;
    try {
        await init();
        const R = _React;

        // Expose the resolved useServerData() cache to the SSR bundle via
        // globalThis.__hadarsUnsuspend — same bridge used on the main thread.
        // Safe in a worker because rendering is sequential (no concurrent requests).
        const unsuspend = (msg.appProps?.context as any)?._unsuspend ?? null;

        // ── renderStream — streaming response via ReadableStream chunks ───────────
        if (type === 'renderStream') {
            const { appProps, clientProps } = msg as {
                appProps: Record<string, unknown>;
                clientProps: Record<string, unknown>;
            };
            const ReactPage = buildReactPage(R, appProps, clientProps);
            (globalThis as any).__hadarsUnsuspend = unsuspend;
            const stream = await _renderToReadableStream!(ReactPage);
            (globalThis as any).__hadarsUnsuspend = null;
            const reader = stream.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                // Transfer the underlying ArrayBuffer to avoid a copy across threads.
                parentPort!.postMessage({ id, type: 'chunk', chunk: value }, [value.buffer as ArrayBuffer]);
            }
            parentPort!.postMessage({ id, type: 'done' });
            return;
        }

        // ── renderString (type === 'renderString' or legacy messages) ────────────
        const { appProps, clientProps } = msg as {
            appProps: Record<string, unknown>;
            clientProps: Record<string, unknown>;
        };
        const ReactPage = buildReactPage(R, appProps, clientProps);
        (globalThis as any).__hadarsUnsuspend = unsuspend;
        const html = _renderToString!(ReactPage);
        (globalThis as any).__hadarsUnsuspend = null;
        parentPort!.postMessage({ id, html });

    } catch (err: any) {
        (globalThis as any).__hadarsUnsuspend = null;
        const errMsg = err?.message ?? String(err);
        if (type === 'renderStream') {
            parentPort!.postMessage({ id, type: 'error', error: errMsg });
        } else {
            parentPort!.postMessage({ id, error: errMsg });
        }
    }
});
