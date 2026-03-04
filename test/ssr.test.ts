/**
 * SSR integration tests — run with `bun test`.
 *
 * Starts the pre-built website server, makes real HTTP requests, and asserts:
 *   - Page is server-rendered with the correct head tags
 *   - useServerData() ran on the server and its result is in the page JSON
 *   - getInitProps() data is in the client props (and server-only keys are stripped)
 *   - HTTP compression is applied
 *   - loadModule() code-split LazyPanel into a separate JS chunk
 *   - /cache-test is served from cache (frozen serverTime on repeated requests)
 *
 * Prerequisites (handled by the CI workflow):
 *   npm run build:all
 *   cd website && npm install && node node_modules/.bin/hadars build
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT        = join(import.meta.dir, '..');
const WEBSITE_DIR = join(ROOT, 'website');
const BIN         = join(WEBSITE_DIR, 'node_modules', '.bin', 'hadars');
const BASE_URL    = 'http://localhost:9090';

// ── server lifecycle ──────────────────────────────────────────────────────────

let server: ReturnType<typeof Bun.spawn> | undefined;

async function waitForServer(url: string, timeout = 30_000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.status < 500) return;
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 400));
    }
    throw new Error(`Server at ${url} did not start within ${timeout}ms`);
}

beforeAll(async () => {
    server = Bun.spawn([BIN, 'run'], {
        cwd: WEBSITE_DIR,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    await waitForServer(BASE_URL);
});

afterAll(() => {
    server?.kill();
});

// ── helpers ───────────────────────────────────────────────────────────────────

interface PageResult {
    res: Response;
    html: string;
    props: Record<string, any>;
}

async function getPage(): Promise<PageResult> {
    const res  = await fetch(BASE_URL + '/');
    const html = await res.text();
    const m    = html.match(/<script id="hadars" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
    const props = m ? (JSON.parse(m[1]).hadars?.props ?? {}) : {};
    return { res, html, props };
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('GET / returns 200 with HTML content-type', async () => {
    const { res } = await getPage();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
});

test('SSR renders the correct <title> tag', async () => {
    const { html } = await getPage();
    expect(html).toContain('<title>hadars — SSR for React</title>');
});

test('useServerData: server_stats is populated on the server', async () => {
    const { props } = await getPage();
    const stats = props.__serverData?.server_stats;
    expect(stats).toBeDefined();
    expect(typeof stats.pid).toBe('number');
    expect(typeof stats.mem).toBe('number');
    expect(stats.pid).toBeGreaterThan(0);
    expect(stats.mem).toBeGreaterThan(0);
});

test('getInitProps: serverTime and bunVersion are in the serialised props', async () => {
    const { props } = await getPage();
    expect(props.serverTime).toBeTruthy();
    expect(props.bunVersion).toBeTruthy();
    // rcClient must be stripped by getFinalProps — it's not serialisable
    expect(props.rcClient).toBeUndefined();
});

test('HTTP gzip compression is applied to HTML responses', async () => {
    const res = await fetch(BASE_URL + '/', {
        headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.headers.get('content-encoding')).toBe('gzip');
});

test('loadModule: LazyPanel is code-split into a separate JS chunk', async () => {
    const staticDir = join(WEBSITE_DIR, '.hadars', 'static');
    const files     = await readdir(staticDir);
    const jsChunks  = files.filter(f => f.endsWith('.js'));
    expect(jsChunks.length).toBeGreaterThanOrEqual(2);
});

// ── cache tests ───────────────────────────────────────────────────────────────

async function getCachePage(): Promise<{ res: Response; html: string; serverTime: string }> {
    const res  = await fetch(BASE_URL + '/cache-test');
    const html = await res.text();
    const m    = html.match(/<script id="hadars" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
    const props = m ? (JSON.parse(m[1]).hadars?.props ?? {}) : {};
    return { res, html, serverTime: props.serverTime ?? '' };
}

test('cache: GET /cache-test returns 200 with correct title', async () => {
    const { res, html } = await getCachePage();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<title>Cache test — hadars</title>');
});

test('cache: repeated requests to /cache-test return the same serverTime (cache hit)', async () => {
    const { serverTime: first } = await getCachePage();
    expect(first).toBeTruthy();

    // Small pause so the background gzip+store task completes before the second request.
    await new Promise(r => setTimeout(r, 50));

    const { serverTime: second } = await getCachePage();
    expect(second).toBe(first);
});

test('cache: cached /cache-test response is served pre-compressed with gzip', async () => {
    // Warm the cache (first request populates it in the background).
    await getCachePage();
    await new Promise(r => setTimeout(r, 50));

    // Second request is a cache hit — body was pre-compressed at store time.
    const res = await fetch(BASE_URL + '/cache-test', {
        headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.headers.get('content-encoding')).toBe('gzip');
});

// ── custom fetch handler ───────────────────────────────────────────────────────

test('custom fetch handler: /api/data returns weather JSON', async () => {
    const res = await fetch(BASE_URL + '/api/data');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const data = await res.json() as Record<string, unknown>;
    expect(data.current_weather).toBeDefined();
});
