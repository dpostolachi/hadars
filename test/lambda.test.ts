/**
 * Lambda adapter integration tests.
 *
 * Uses the `bundled` code path — loads the pre-built website's
 * `.hadars/index.ssr.js` and `out.html` directly, then passes them to
 * `createLambdaHandler` as pre-loaded values. No HTTP server needed.
 *
 * Prerequisites (same as ssr.test.ts):
 *   bun run build:all
 *   cd website && bun install && bun node_modules/.bin/hadars build
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLambdaHandler } from '../src/lambda';
import type { APIGatewayV2Event, APIGatewayV1Event } from '../src/lambda';
import type { HadarsOptions } from '../src/types/hadars';
import type { HadarsEntryModule } from '../src/types/hadars';

const ROOT        = join(import.meta.dir, '..');
const WEBSITE_DIR = join(ROOT, 'website');
const BIN         = join(WEBSITE_DIR, 'node_modules', '.bin', 'hadars');
const BASE_URL    = 'http://localhost:9090';
const SSR_BUNDLE  = join(WEBSITE_DIR, '.hadars', 'index.ssr.js');
const OUT_HTML    = join(WEBSITE_DIR, '.hadars', 'static', 'out.html');

// ── server lifecycle (mirrors ssr.test.ts) ────────────────────────────────────
// The website's SSR bundle fetches from http://localhost:9090/api/data during
// rendering (SuspenseQueryRow). We need the server running so that call succeeds.

let server: ReturnType<typeof Bun.spawn> | undefined;
let serverOwnedByTest = false;

async function waitForServer(url: string, timeout = 60_000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try { const res = await fetch(url); if (res.status < 500) return; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Server at ${url} did not start within ${timeout}ms`);
}

async function isServerRunning(url: string): Promise<boolean> {
    try { return (await fetch(url)).status < 500; } catch { return false; }
}

// ── fixtures ──────────────────────────────────────────────────────────────────

let handler: ReturnType<typeof createLambdaHandler>;

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    // Stub /api/data so the lambda handler doesn't make real network calls for
    // routes that come in as Lambda events — the internal SSR fetch to
    // http://localhost:9090/api/data is handled by the running website server.
    fetch: (req) => {
        if (req.pathname === '/api/data') {
            return new Response(JSON.stringify({ current_weather: { temperature: 20 } }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }
    },
};

beforeAll(async () => {
    if (!(await isServerRunning(BASE_URL))) {
        serverOwnedByTest = true;
        server = Bun.spawn([BIN, 'run'], {
            cwd: WEBSITE_DIR,
            stdout: 'inherit',
            stderr: 'inherit',
        });
        await waitForServer(BASE_URL);
    }

    const ssrModule = await import(SSR_BUNDLE) as HadarsEntryModule<any>;
    const outHtml   = await readFile(OUT_HTML, 'utf-8');
    handler = createLambdaHandler(config, { ssrModule, outHtml });
});

afterAll(() => {
    if (serverOwnedByTest) server?.kill();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeV2Event(path: string, opts: { headers?: Record<string, string> } = {}): APIGatewayV2Event {
    return {
        version: '2.0',
        routeKey: '$default',
        rawPath: path,
        rawQueryString: '',
        headers: { host: 'example.execute-api.us-east-1.amazonaws.com', ...opts.headers },
        requestContext: {
            http: { method: 'GET' },
            domainName: 'example.execute-api.us-east-1.amazonaws.com',
        },
        isBase64Encoded: false,
    };
}

function makeV1Event(path: string): APIGatewayV1Event {
    return {
        httpMethod: 'GET',
        path,
        headers: { host: 'example.execute-api.us-east-1.amazonaws.com' },
        isBase64Encoded: false,
    };
}

function extractProps(body: string): Record<string, any> {
    const m = body.match(/<script id="hadars" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
    return m ? (JSON.parse(m[1] ?? '{}').hadars?.props ?? {}) : {};
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('lambda: GET / returns 200 with HTML content-type (v2 event)', async () => {
    const result = await handler(makeV2Event('/'));
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toContain('text/html');
    expect(result.isBase64Encoded).toBe(false);
});

test('lambda: GET / renders correct <title> tag', async () => {
    const result = await handler(makeV2Event('/'));
    expect(result.body).toContain('<title>hadars — SSR for React</title>');
});

test('lambda: GET / contains <div id="app"> with rendered content', async () => {
    const result = await handler(makeV2Event('/'));
    expect(result.body).toContain('<div id="app">');
    expect(result.body).toContain('<script id="hadars" type="application/json">');
});

test('lambda: useServerData server_stats is in the serialised props', async () => {
    const result = await handler(makeV2Event('/'));
    const props  = extractProps(result.body);
    // Keys are now auto-generated via useId() — find the entry by shape.
    const stats = Object.values(props.__serverData ?? {}).find(
        (v: any) => typeof v?.pid === 'number' && typeof v?.mem === 'number',
    ) as { pid: number; mem: number } | undefined;
    expect(stats).toBeDefined();
    expect(stats!.pid).toBeGreaterThan(0);
});

test('lambda: getInitProps serverTime and bunVersion are present', async () => {
    const result = await handler(makeV2Event('/'));
    const props  = extractProps(result.body);
    expect(props.serverTime).toBeTruthy();
    expect(props.bunVersion).toBeTruthy();
    expect(props.rcClient).toBeUndefined(); // stripped by getFinalProps
});

test('lambda: Accept: application/json returns JSON serverData', async () => {
    const result = await handler(makeV2Event('/', { headers: { accept: 'application/json', host: 'example.execute-api.us-east-1.amazonaws.com' } }));
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toContain('application/json');
    const json = JSON.parse(result.body) as { serverData: Record<string, unknown> };
    expect(json.serverData).toBeDefined();
    // Key is auto-generated via useId() — verify at least one entry exists.
    expect(Object.keys(json.serverData).length).toBeGreaterThan(0);
});

test('lambda: custom fetch handler returns stubbed /api/data JSON (v2 event)', async () => {
    const result = await handler(makeV2Event('/api/data'));
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toContain('application/json');
    const json = JSON.parse(result.body) as { current_weather: { temperature: number } };
    expect(json.current_weather.temperature).toBe(20);
});

test('lambda: v1 (REST API) event format also returns 200 HTML', async () => {
    const result = await handler(makeV1Event('/'));
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toContain('text/html');
    expect(result.body).toContain('<title>hadars — SSR for React</title>');
});
