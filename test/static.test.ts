/**
 * Static export integration tests.
 *
 * Calls renderStaticSite() directly with the pre-built website's SSR bundle
 * and HTML template. No build step or HTTP server required.
 *
 * Prerequisites (same as ssr.test.ts / lambda.test.ts):
 *   npm run build:all
 *   cd website && bun install && bun node_modules/.bin/hadars build
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderStaticSite } from '../src/static';
import type { HadarsEntryModule } from '../src/types/hadars';

const ROOT        = join(import.meta.dir, '..');
const WEBSITE_DIR = join(ROOT, 'website');
const SSR_BUNDLE  = join(WEBSITE_DIR, '.hadars', 'index.ssr.js');
const OUT_HTML    = join(WEBSITE_DIR, '.hadars', 'static', 'out.html');
const STATIC_SRC  = join(WEBSITE_DIR, '.hadars', 'static');
const OUT_DIR     = join(ROOT, '.hadars-static-test-output');

// Doc pages — no external API calls during SSR, safe to render in tests.
const TEST_PATHS = [
    '/docs/getting-started',
    '/docs/api',
    '/docs/deployment',
];

let result: Awaited<ReturnType<typeof renderStaticSite>>;

beforeAll(async () => {
    const ssrModule  = await import(pathToFileURL(SSR_BUNDLE).href) as HadarsEntryModule<any>;
    const htmlSource = await readFile(OUT_HTML, 'utf-8');
    result = await renderStaticSite({ ssrModule, htmlSource, staticSrc: STATIC_SRC, paths: TEST_PATHS, outputDir: OUT_DIR });
});

afterAll(async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
});

// ── rendered list ─────────────────────────────────────────────────────────────

test('static: all paths are in the rendered list', () => {
    expect(result.rendered).toEqual(expect.arrayContaining(TEST_PATHS));
    expect(result.rendered.length).toBe(TEST_PATHS.length);
});

test('static: no errors', () => {
    expect(result.errors).toHaveLength(0);
});

// ── file layout ───────────────────────────────────────────────────────────────

test('static: each path produces an index.html file', () => {
    for (const p of TEST_PATHS) {
        expect(existsSync(join(OUT_DIR, p, 'index.html'))).toBe(true);
    }
});

// ── HTML structure ────────────────────────────────────────────────────────────

async function html(urlPath: string) {
    return readFile(join(OUT_DIR, urlPath, 'index.html'), 'utf-8');
}

test('static: HTML contains doctype and html element', async () => {
    const doc = (await html('/docs/getting-started')).toLowerCase();
    expect(doc).toContain('<!doctype');
    expect(doc).toContain('<html');
});

test('static: HTML contains rendered <div id="app">', async () => {
    const doc = await html('/docs/getting-started');
    expect(doc).toContain('<div id="app">');
});

test('static: HTML contains serialised props script', async () => {
    const doc = await html('/docs/getting-started');
    expect(doc).toContain('<script id="hadars" type="application/json">');
});

test('static: title tag is rendered by HadarsHead', async () => {
    const doc = await html('/docs/getting-started');
    expect(doc).toContain('<title>');
    // The Getting Started page sets its own title
    expect(doc).toContain('Getting Started');
});

test('static: each page has unique title', async () => {
    const [gs, api, dep] = await Promise.all([
        html('/docs/getting-started'),
        html('/docs/api'),
        html('/docs/deployment'),
    ]);
    const title = (h: string) => h.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
    expect(title(gs)).not.toBe(title(api));
    expect(title(api)).not.toBe(title(dep));
});

test('static: page body contains actual content (not blank)', async () => {
    const doc = await html('/docs/getting-started');
    const appMatch = doc.match(/<div id="app">([\s\S]*?)<\/div>/);
    expect(appMatch?.[1]?.trim().length).toBeGreaterThan(100);
});

// ── JSON sidecars (useServerData on client navigation) ────────────────────────

test('static: each path has an index.json sidecar', () => {
    for (const p of TEST_PATHS) {
        expect(existsSync(join(OUT_DIR, p, 'index.json'))).toBe(true);
    }
});

test('static: index.json has { serverData } shape', async () => {
    const raw  = await readFile(join(OUT_DIR, '/docs/getting-started', 'index.json'), 'utf-8');
    const json = JSON.parse(raw) as { serverData: Record<string, unknown> };
    expect(json).toHaveProperty('serverData');
    expect(typeof json.serverData).toBe('object');
});

// ── static assets ─────────────────────────────────────────────────────────────

test('static: static/ directory is created in output', () => {
    expect(existsSync(join(OUT_DIR, 'static'))).toBe(true);
});

test('static: JS assets are copied to static/', async () => {
    const files = await readdir(join(OUT_DIR, 'static'));
    expect(files.some(f => f.endsWith('.js'))).toBe(true);
});

test('static: out.html is not copied to static/', () => {
    expect(existsSync(join(OUT_DIR, 'static', 'out.html'))).toBe(false);
});
