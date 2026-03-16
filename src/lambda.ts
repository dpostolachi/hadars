/**
 * AWS Lambda adapter for hadars.
 *
 * After running `hadars build`, import this in your Lambda entry file:
 *
 *   // lambda.ts
 *   import { createLambdaHandler } from 'hadars/lambda';
 *   import config from './hadars.config';
 *   export const handler = createLambdaHandler(config);
 *
 * The returned handler speaks the API Gateway HTTP API (v2) payload format.
 * API Gateway REST API (v1) events are also accepted.
 *
 * Static assets (JS, CSS, fonts) are served directly from the bundled
 * `.hadars/static/` directory. For production use, front the Lambda with
 * CloudFront and route static paths to an S3 origin instead.
 */

import React from 'react';
import pathMod from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { createProxyHandler } from './utils/proxyHandler';
import { parseRequest } from './utils/request';
import { tryServeFile } from './utils/staticFile';
import { getReactResponse } from './utils/response';
import { buildSsrResponse, buildSsrHtml, makePrecontentHtmlGetter, createRenderCache } from './utils/ssrHandler';
import type { HadarsOptions, HadarsEntryModule, HadarsProps } from './types/hadars';

// ── Lambda event / response types ────────────────────────────────────────────

/** API Gateway HTTP API (v2) event. */
export interface APIGatewayV2Event {
    version: '2.0';
    routeKey: string;
    rawPath: string;
    rawQueryString: string;
    cookies?: string[];
    headers: Record<string, string>;
    requestContext: {
        http: { method: string };
        domainName: string;
    };
    body?: string;
    isBase64Encoded: boolean;
}

/** API Gateway REST API (v1) event. */
export interface APIGatewayV1Event {
    httpMethod: string;
    path: string;
    queryStringParameters?: Record<string, string> | null;
    headers?: Record<string, string> | null;
    body?: string | null;
    isBase64Encoded: boolean;
}

export type APIGatewayEvent = APIGatewayV2Event | APIGatewayV1Event;

export interface LambdaResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    isBase64Encoded: boolean;
}

export type LambdaHandler = (event: APIGatewayEvent) => Promise<LambdaResponse>;

// ── Event → Request ───────────────────────────────────────────────────────────

function eventToRequest(event: APIGatewayEvent): Request {
    let method: string;
    let path: string;
    let queryString: string;
    let headers: Record<string, string>;
    let rawBody: string | undefined | null;
    let isBase64: boolean;
    let host: string;

    if ('version' in event && event.version === '2.0') {
        method      = event.requestContext.http.method;
        path        = event.rawPath;
        queryString = event.rawQueryString;
        headers     = { ...event.headers };
        // v2 puts cookies in a separate array; merge them back into the header
        if (event.cookies?.length) headers['cookie'] = event.cookies.join('; ');
        rawBody     = event.body;
        isBase64    = event.isBase64Encoded;
        host        = event.requestContext.domainName;
    } else {
        const e  = event as APIGatewayV1Event;
        method      = e.httpMethod;
        path        = e.path;
        const qs    = e.queryStringParameters;
        queryString = qs ? new URLSearchParams(qs as Record<string, string>).toString() : '';
        headers     = (e.headers as Record<string, string>) ?? {};
        rawBody     = e.body;
        isBase64    = e.isBase64Encoded;
        host        = headers['host'] ?? 'lambda';
    }

    const url  = `https://${host}${path}${queryString ? '?' + queryString : ''}`;
    let body: BodyInit | undefined;
    if (rawBody) body = isBase64 ? Buffer.from(rawBody, 'base64') : rawBody;

    return new Request(url, {
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method) ? undefined : body,
    });
}

// ── Response → Lambda ─────────────────────────────────────────────────────────

const TEXT_RE = /\b(?:text\/|application\/(?:json|javascript|xml)|image\/svg\+xml)/;

async function responseToLambda(response: Response): Promise<LambdaResponse> {
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => { headers[k] = v; });

    const contentType = response.headers.get('Content-Type') ?? '';
    if (TEXT_RE.test(contentType)) {
        return {
            statusCode: response.status,
            headers,
            body: await response.text(),
            isBase64Encoded: false,
        };
    }

    // Binary response (images, fonts, pre-compressed assets, etc.)
    return {
        statusCode: response.status,
        headers,
        body: Buffer.from(await response.arrayBuffer()).toString('base64'),
        isBase64Encoded: true,
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

const HadarsFolder = './.hadars';
const StaticPath   = `${HadarsFolder}/static`;
const SSR_FILENAME = 'index.ssr.js';
const noopCtx      = { upgrade: () => false };

/**
 * Pre-loaded module and HTML for single-file Lambda bundles created by
 * `hadars export lambda`. Passing this bypasses all runtime file I/O so
 * the handler works without a `.hadars/` directory on disk.
 */
export interface LambdaBundled {
    /** The compiled SSR module — import it statically in your entry shim. */
    ssrModule: HadarsEntryModule<any>;
    /**
     * The contents of `.hadars/static/out.html` — load it as a text string
     * at build time (esbuild's `--loader:.html=text` does this automatically
     * when `hadars export lambda` runs).
     */
    outHtml: string;
}

/**
 * Creates an AWS Lambda handler from a hadars config.
 *
 * Must be called after `hadars build` has produced the `.hadars/` output
 * directory. The handler is stateless — Lambda can reuse the same instance
 * across invocations; the SSR module and HTML template are cached in memory
 * after the first warm invocation.
 *
 * Pass a {@link LambdaBundled} object as the second argument when using
 * `hadars export lambda` to produce a single-file bundle — in that mode all
 * I/O is eliminated and the handler is fully self-contained.
 *
 * @example — standard (file-based) deployment
 * export const handler = createLambdaHandler(config);
 *
 * @example — single-file bundle (generated entry shim)
 * import * as ssrModule from './.hadars/index.ssr.js';
 * import outHtml from './.hadars/static/out.html';
 * export const handler = createLambdaHandler(config, { ssrModule, outHtml });
 */
export function createLambdaHandler(options: HadarsOptions, bundled?: LambdaBundled): LambdaHandler {
    const cwd          = process.cwd();
    const fetchHandler = options.fetch;
    const handleProxy  = createProxyHandler(options);

    const getPrecontentHtml = bundled
        ? makePrecontentHtmlGetter(Promise.resolve(bundled.outHtml))
        : makePrecontentHtmlGetter(fs.readFile(pathMod.join(cwd, StaticPath, 'out.html'), 'utf-8'));

    // Hoist the SSR module reference so it is resolved once, not on every
    // request. In bundled mode the module is already in-memory; in file-based
    // mode we lazily import it and cache the promise so Node's module cache is
    // only consulted once.
    let ssrModulePromise: Promise<HadarsEntryModule<any>> | null = null;
    const getSsrModule = (): Promise<HadarsEntryModule<any>> => {
        if (bundled) return Promise.resolve(bundled.ssrModule);
        if (!ssrModulePromise) {
            ssrModulePromise = import(
                pathToFileURL(pathMod.resolve(cwd, HadarsFolder, SSR_FILENAME)).href
            ) as Promise<HadarsEntryModule<any>>;
        }
        return ssrModulePromise;
    };

    const runHandler = async (req: Request): Promise<Response> => {
        const request = parseRequest(req);

        if (fetchHandler) {
            const res = await fetchHandler(request);
            if (res) return res;
        }

        const proxied = await handleProxy(request);
        if (proxied) return proxied;

        const urlPath = new URL(request.url).pathname;

        if (!bundled) {
            // File-based deployment: serve static assets from disk.
            const staticRes = await tryServeFile(pathMod.join(cwd, StaticPath, urlPath));
            if (staticRes) return staticRes;

            const projectStaticPath = pathMod.resolve(cwd, 'static');
            const projectRes = await tryServeFile(pathMod.join(projectStaticPath, urlPath));
            if (projectRes) return projectRes;

            const routeClean = urlPath.replace(/(^\/|\/$)/g, '');
            if (routeClean) {
                const routeRes = await tryServeFile(
                    pathMod.join(cwd, StaticPath, routeClean, 'index.html'),
                );
                if (routeRes) return routeRes;
            }
        }
        // bundled mode: static assets are not served from Lambda — route them to S3/CDN.

        try {
            const {
                default: Component,
                getInitProps,
                getAfterRenderProps,
                getFinalProps,
            } = await getSsrModule();

            const { bodyHtml, clientProps, status, headHtml } = await getReactResponse(request, {
                document: {
                    body: Component as React.FC<HadarsProps<object>>,
                    lang: 'en',
                    getInitProps,
                    getAfterRenderProps,
                    getFinalProps,
                },
            });

            if (request.headers.get('Accept') === 'application/json') {
                const serverData = (clientProps as any).__serverData ?? {};
                return new Response(JSON.stringify({ serverData }), {
                    status,
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                });
            }

            // Build the HTML string directly — avoids creating a ReadableStream
            // that would immediately be drained by the Lambda response serialiser.
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

    const finalHandler: (req: Request, ctx: any) => Promise<Response | undefined> = options.cache
        ? createRenderCache(options.cache, (req) => runHandler(req))
        : (req: Request) => runHandler(req);

    return async (event: APIGatewayEvent): Promise<LambdaResponse> => {
        const req      = eventToRequest(event);
        const response = (await finalHandler(req, noopCtx)) ?? new Response('Not Found', { status: 404 });
        return responseToLambda(response);
    };
}
