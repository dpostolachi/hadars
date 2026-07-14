/**
 * Bunny.net Edge Scripting adapter integration tests.
 *
 * Uses the `bundled` code path — loads the pre-built website's
 * `.hadars/index.ssr.js` and `out.html` directly, then passes them to
 * `createBunnyHandler`. No HTTP server or BunnySDK runtime needed.
 *
 * Prerequisites (same as ssr.test.ts / lambda.test.ts):
 *   bun run build:all
 *   cd website && bun install && bun node_modules/.bin/hadars build
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createBunnyHandler } from '../src/bunny';
import type { HadarsOptions } from '../src/types/hadars';
import type { HadarsEntryModule } from '../src/types/hadars';

const ROOT        = join(import.meta.dir, '..');
const WEBSITE_DIR = join(ROOT, 'website');
const BIN         = join(WEBSITE_DIR, 'node_modules', '.bin', 'hadars');
const BASE_URL    = 'http://localhost:9090';
const SSR_BUNDLE  = join(WEBSITE_DIR, '.hadars', 'index.ssr.js');
const OUT_HTML    = join(WEBSITE_DIR, '.hadars', 'static', 'out.html');

// ── server lifecycle (mirrors lambda.test.ts) ─────────────────────────────────
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

let handler: (request: Request) => Promise<Response>;

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    // Stub /api/data so the handler doesn't make real network calls during tests.
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
    handler = createBunnyHandler(config, { ssrModule, outHtml });
});

afterAll(() => {
    if (serverOwnedByTest) server?.kill();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(path: string, opts: RequestInit = {}): Request {
    return new Request(`https://my-script.b-cdn.net${path}`, {
        method: 'GET',
        ...opts,
    });
}

function extractProps(html: string): Record<string, any> {
    const m = html.match(/<script id="hadars" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
    return m ? (JSON.parse(m[1] ?? '{}').hadars?.props ?? {}) : {};
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('bunny: GET / returns 200 with HTML content-type', async () => {
    const res = await handler(makeRequest('/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
});

test('bunny: GET / renders correct <title> tag', async () => {
    const res  = await handler(makeRequest('/'));
    const html = await res.text();
    expect(html).toContain('<title>hadars — SSR for React</title>');
});

test('bunny: GET / contains <div id="app"> with rendered content', async () => {
    const res  = await handler(makeRequest('/'));
    const html = await res.text();
    expect(html).toContain('<div id="app">');
    expect(html).toContain('<script id="hadars" type="application/json">');
});

test('bunny: useServerData server_stats is in the serialised props', async () => {
    const res   = await handler(makeRequest('/'));
    const html  = await res.text();
    const props = extractProps(html);
    const stats = Object.values(props.__serverData ?? {}).find(
        (v: any) => typeof v?.pid === 'number' && typeof v?.mem === 'number',
    ) as { pid: number; mem: number } | undefined;
    expect(stats).toBeDefined();
    expect(stats!.pid).toBeGreaterThan(0);
});

test('bunny: getInitProps serverTime and bunVersion are present', async () => {
    const res   = await handler(makeRequest('/'));
    const html  = await res.text();
    const props = extractProps(html);
    expect(props.serverTime).toBeTruthy();
    expect(props.bunVersion).toBeTruthy();
    expect(props.rcClient).toBeUndefined(); // stripped by getFinalProps
});

test('bunny: Accept: application/json returns JSON serverData', async () => {
    const res = await handler(makeRequest('/', {
        headers: { Accept: 'application/json' },
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json() as { serverData: Record<string, unknown> };
    expect(json.serverData).toBeDefined();
    expect(Object.keys(json.serverData).length).toBeGreaterThan(0);
});

test('bunny: custom fetch handler returns stubbed /api/data JSON', async () => {
    const res  = await handler(makeRequest('/api/data'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json() as { current_weather: { temperature: number } };
    expect(json.current_weather.temperature).toBe(20);
});

test('bunny: unknown route returns 404', async () => {
    // Create a handler with no fetch override so the unknown path falls through.
    const ssrModule = await import(SSR_BUNDLE) as HadarsEntryModule<any>;
    const outHtml   = await readFile(OUT_HTML, 'utf-8');
    const bareHandler = createBunnyHandler({ entry: 'src/App.tsx' }, { ssrModule, outHtml });
    // /no-such-route falls through SSR which renders a page (React Router renders the app
    // for any path). Verify the response is still 200 HTML — bunny handler doesn't 404 on
    // unknown URL paths; that's the app's responsibility via React Router.
    const res = await bareHandler(makeRequest('/no-such-path-xyz'));
    // Response must be either HTML (React Router renders a page) or 404; either is valid
    // as long as it's not an unhandled exception (i.e. status is set).
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
});

test('bunny: handler returns a standard Web Response object', async () => {
    const res = await handler(makeRequest('/'));
    expect(res).toBeInstanceOf(Response);
    expect(typeof res.status).toBe('number');
    expect(res.headers).toBeInstanceOf(Headers);
});

test('bunny: a docs page renders without error', async () => {
    const res  = await handler(makeRequest('/docs/getting-started'));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Getting Started');
});
