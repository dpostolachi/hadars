/**
 * Cloudflare Workers adapter for hadars.
 *
 * After running `hadars build`, bundle your app with:
 *
 *   hadars export cloudflare
 *
 * This produces a self-contained `cloudflare.mjs` that you deploy with:
 *
 *   wrangler deploy
 *
 * Static assets (JS, CSS, fonts) under `.hadars/static/` must be served from
 * R2 or another CDN — the Worker only handles HTML rendering. Route requests
 * for static file extensions to R2 and everything else to the Worker.
 *
 * @example wrangler.toml
 *   name = "my-app"
 *   main = "cloudflare.mjs"
 *   compatibility_date = "2024-09-23"
 *   compatibility_flags = ["nodejs_compat"]
 */

import React from 'react';
import { parseRequest } from './utils/request';
import { createProxyHandler } from './utils/proxyHandler';
import { getReactResponse, buildHeadHtml } from './utils/response';
import { buildSsrHtml, makePrecontentHtmlGetter, createRenderCache } from './utils/ssrHandler';
import type { HadarsOptions, HadarsEntryModule, HadarsProps } from './types/hadars';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Pre-loaded SSR module and HTML template for single-file Cloudflare bundles
 * produced by `hadars export cloudflare`. All I/O is eliminated at runtime —
 * the Worker is fully self-contained.
 */
export interface CloudflareBundled {
    /** The compiled SSR module — import it statically in your entry shim. */
    ssrModule: HadarsEntryModule<any>;
    /**
     * The contents of `.hadars/static/out.html` — esbuild inlines this as a
     * string when `hadars export cloudflare` runs.
     */
    outHtml: string;
}

/**
 * The shape of a Cloudflare Workers export object.
 * Return this as the default export of your Worker entry file.
 */
export interface CloudflareHandler {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
}

// ── Handler factory ───────────────────────────────────────────────────────────

/**
 * Creates a Cloudflare Workers handler from a hadars config and a pre-bundled
 * SSR module. Use this as the default export of your Worker entry.
 *
 * Unlike the Lambda adapter, Cloudflare Workers receive a standard Web
 * `Request` and return a standard `Response` — no event format conversion is
 * required. Static assets must be routed to R2/CDN via wrangler rules; this
 * Worker handles only HTML rendering and API routes.
 *
 * @example — generated entry shim (created by `hadars export cloudflare`)
 * import * as ssrModule from './.hadars/index.ssr.js';
 * import outHtml from './.hadars/static/out.html';
 * import { createCloudflareHandler } from 'hadars/cloudflare';
 * import config from './hadars.config';
 * export default createCloudflareHandler(config, { ssrModule, outHtml });
 */
export function createCloudflareHandler(
    options: HadarsOptions,
    bundled: CloudflareBundled,
): CloudflareHandler {
    const fetchHandler     = options.fetch;
    const handleProxy      = createProxyHandler(options);
    const getPrecontentHtml = makePrecontentHtmlGetter(Promise.resolve(bundled.outHtml));
    const { ssrModule }    = bundled;

    const runHandler = async (req: Request): Promise<Response> => {
        const request = parseRequest(req);

        if (fetchHandler) {
            const res = await fetchHandler(request);
            if (res) return res;
        }

        const proxied = await handleProxy(request);
        if (proxied) return proxied;

        try {
            const { default: Component, getInitProps, getFinalProps } = ssrModule;

            const { head, status, getAppBody, finalize } = await getReactResponse(request, {
                document: {
                    body: Component as React.FC<HadarsProps<object>>,
                    lang: 'en',
                    getInitProps,
                    getFinalProps,
                },
            });

            // Data-only requests from client-side navigation.
            if (request.headers.get('Accept') === 'application/json') {
                const { clientProps } = await finalize();
                const serverData = (clientProps as any).__serverData ?? {};
                return new Response(JSON.stringify({ serverData }), {
                    status,
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                });
            }

            const bodyHtml = await getAppBody();
            const { clientProps } = await finalize();
            const headHtml = buildHeadHtml(head);
            const html = await buildSsrHtml(bodyHtml, clientProps, headHtml, getPrecontentHtml);

            return new Response(html, {
                status,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        } catch (err: any) {
            console.error('[hadars] SSR render error:', err);
            return new Response('Internal Server Error', { status: 500 });
        }
    };

    const finalFetch = options.cache
        ? createRenderCache(options.cache, (req) => runHandler(req))
        : (req: Request) => runHandler(req);

    return {
        fetch: async (request: Request, _env: unknown, ctx: unknown): Promise<Response> => {
            return (await finalFetch(request, ctx)) ?? new Response('Not Found', { status: 404 });
        },
    };
}
