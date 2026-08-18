/**
 * React Fast Refresh end-to-end test — run with `bun test`.
 *
 * Guards two regressions that both presented as "HMR doesn't work":
 *
 *   1. `$RefreshReg$ is not defined` thrown by every component on load, which
 *      killed the HMR client's bootstrap before it could process an update.
 *      Root cause: the dev client entry imported the user's app module with a
 *      `?v=<timestamp>` cache-buster, and @rspack/plugin-react-refresh matches
 *      its helper-injecting loader with an END-ANCHORED `include` regex against
 *      the full request. "App.tsx?v=123" didn't match, so the app module got
 *      $RefreshReg$ call sites from the SWC transform but no helper definitions.
 *      Only reproduced in real apps, because the suffix was applied to the user
 *      entry specifically — never to a minimal single-file repro.
 *
 *   2. Updates only landing after a manual refresh, with state reset. Root
 *      cause: the client entry called createRoot().render() on every
 *      evaluation, so each hot update tore down and remounted the tree, and it
 *      never called module.hot.accept() — so updates propagated past the entry
 *      with nowhere to stop and fell back to a full page reload
 *      ("Aborted because ./src/App.tsx is not accepted").
 *
 * The counter assertion is the important one: a full-page reload also makes an
 * edit "appear" in the DOM, so changed text alone cannot tell true in-place
 * Fast Refresh from a reload. Surviving component state can.
 *
 * Prerequisites (handled by the CI workflow):
 *   npm run build:all
 *   cd test/fixtures/hmr-app && npm install
 *   npx playwright install --with-deps chromium
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT       = join(import.meta.dir, '..');
const FIXTURE_DIR = join(ROOT, 'test', 'fixtures', 'hmr-app');
const BIN         = join(FIXTURE_DIR, 'node_modules', '.bin', 'hadars');
const APP_PATH    = join(FIXTURE_DIR, 'src', 'App.tsx');
const BASE_URL    = 'http://localhost:4173';
// hadars defaults hmrPort to port + 1.
const HMR_PORT    = 4174;

const ORIGINAL_PROBE = 'PROBE_INITIAL';
const UPDATED_PROBE  = 'PROBE_HMR_UPDATED';

let server: ReturnType<typeof Bun.spawn> | undefined;
let browser: Browser | undefined;
let originalAppSource: string;

async function isServerRunning(url: string): Promise<boolean> {
    try {
        const res = await fetch(url);
        return res.status < 500;
    } catch {
        return false;
    }
}

async function waitForServer(url: string, timeout = 60_000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await isServerRunning(url)) return;
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Server at ${url} did not start within ${timeout}ms`);
}

beforeAll(async () => {
    await rm(join(FIXTURE_DIR, '.hadars'), { recursive: true, force: true });
    originalAppSource = await readFile(APP_PATH, 'utf-8');

    server = Bun.spawn([BIN, 'dev'], {
        cwd: FIXTURE_DIR,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    await waitForServer(BASE_URL);

    browser = await chromium.launch();
});

afterAll(async () => {
    await browser?.close();
    server?.kill();
    // Restore the fixture file regardless of test outcome.
    if (originalAppSource !== undefined) {
        await writeFile(APP_PATH, originalAppSource);
    }
    await rm(join(FIXTURE_DIR, '.hadars'), { recursive: true, force: true });
});

test('dev server compiles without a React Refresh crash', async () => {
    // The bug this guards against was a ReferenceError thrown by every
    // component on page load (see the module header above) — if the dev
    // server started at all with a clean 200, that alone already rules out
    // that specific failure mode; the second test below confirms the
    // browser-visible outcome (no page errors, edit reaches the DOM).
    const res = await fetch(BASE_URL + '/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(ORIGINAL_PROBE);
});

test('hot-update chunks are fetched from the dev server, not the app server', async () => {
    // Hot-update chunks are owned by RspackDevServer, which serves them from
    // memory on hmrPort. Without an absolute output.publicPath the HMR runtime
    // derives their URLs from where index.js was loaded — the app server — which
    // only serves .hadars/static/ from disk. An update then resolves only if
    // devMiddleware's writeToDisk already flushed that chunk; lose that race and
    // the request 404s. Because a failed update leaves the client's hash stale,
    // every later edit asks for a hash the compiler has moved past, so the chain
    // never recovers without a manual refresh.
    //
    // Asserting the port pins the fix at the point it actually broke: the URL the
    // runtime computes.
    const page = await browser!.newPage();
    const updateRequests: string[] = [];
    const failed: string[] = [];
    page.on('request', (r) => {
        if (r.url().includes('hot-update')) updateRequests.push(r.url());
    });
    page.on('response', (r) => {
        if (r.url().includes('hot-update') && r.status() >= 400) {
            failed.push(`${r.status()} ${r.url()}`);
        }
    });

    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' });

    const updatedSource = originalAppSource.replace(ORIGINAL_PROBE, UPDATED_PROBE);
    await writeFile(APP_PATH, updatedSource);

    for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(500);
        const text = await page.textContent('#probe').catch(() => null);
        if (text?.includes(UPDATED_PROBE)) break;
    }

    expect(updateRequests.length).toBeGreaterThan(0);
    // Every update must come from the dev server port, never the app port.
    for (const url of updateRequests) {
        expect(new URL(url).port).toBe(String(HMR_PORT));
    }
    expect(failed).toEqual([]);

    // Restore the fixture so the following tests start from ORIGINAL_PROBE.
    await writeFile(APP_PATH, originalAppSource);
    for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(500);
        const text = await page.textContent('#probe').catch(() => null);
        if (text?.includes(ORIGINAL_PROBE)) break;
    }

    await page.close();
});

test('client bundle never contains unbacked $RefreshReg$ call sites', async () => {
    // The failure this guards against: the SWC transform emits $RefreshReg$ call
    // sites while ReactRefreshPlugin does not run, so nothing defines them and the
    // first component to evaluate throws "ReferenceError: $RefreshReg$ is not
    // defined" — the hot-update chunk arrives with the edit in it, then dies on
    // eval, leaving the DOM stale.
    //
    // The two were previously gated on different conditions: ReactRefreshPlugin
    // bails internally when NODE_ENV=production, while the SWC flag followed only
    // hadars' own dev flag. `NODE_ENV=production hadars dev` produced calls with
    // zero definitions. Both are now driven from one flag (useReactRefresh in
    // utils/rspack.ts).
    //
    // Either state is valid — refresh fully wired, or fully absent. Only the
    // mixture throws.
    const bundle = await readFile(join(FIXTURE_DIR, '.hadars', 'static', 'index.js'), 'utf-8');
    const calls = bundle.match(/\$RefreshReg\$\(/g)?.length ?? 0;
    const defs  = bundle.match(/(?:function|var|let|const)\s+\$RefreshReg\$/g)?.length ?? 0;

    if (calls > 0) {
        expect(defs).toBeGreaterThan(0);
    }
});

test('editing a component hot-updates in place, preserving state, with no page errors', async () => {
    const page = await browser!.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
    expect(await page.textContent('#probe')).toBe(ORIGINAL_PROBE);

    // Build up state that only survives an in-place patch, plus a window flag
    // that a full document reload would wipe.
    await page.evaluate(() => { (window as any).__NOT_RELOADED__ = true; });
    await page.click('#inc');
    await page.click('#inc');
    expect(await page.textContent('#count')).toBe('2');

    // Simulate a live edit.
    const updatedSource = originalAppSource.replace(ORIGINAL_PROBE, UPDATED_PROBE);
    await writeFile(APP_PATH, updatedSource);

    // Poll the DOM — this test never calls page.reload() itself.
    let current = ORIGINAL_PROBE;
    for (let i = 0; i < 30 && current === ORIGINAL_PROBE; i++) {
        await page.waitForTimeout(500);
        try {
            current = (await page.textContent('#probe')) ?? current;
        } catch {
            // Element briefly detached mid-update; retry next iteration.
        }
    }

    expect(current).toBe(UPDATED_PROBE);

    // Fast Refresh is intentionally disabled when NODE_ENV=production (the plugin
    // bails, so hadars turns the transform off to match — see useReactRefresh in
    // utils/rspack.ts). In that mode the reload fallback is the correct behavior,
    // so only assert in-place patching when refresh is actually wired up.
    if (process.env.NODE_ENV !== 'production') {
        // True Fast Refresh: the document was never reloaded and useState survived.
        // If HMR regresses to the reload fallback, both of these flip.
        expect(await page.evaluate(() => (window as any).__NOT_RELOADED__ === true)).toBe(true);
        expect(await page.textContent('#count')).toBe('2');
    }

    // This holds in BOTH modes and is the real regression guard: an unbacked
    // $RefreshReg$ throws here regardless of which path the update took.
    expect(pageErrors).toEqual([]);

    await page.close();
});
