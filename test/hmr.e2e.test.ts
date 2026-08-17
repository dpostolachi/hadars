/**
 * Client-side HMR end-to-end test — run with `bun test`.
 *
 * Regression test for a bug where `hadars dev`'s client bundle failed to
 * hot-update in the browser at all: React Refresh instrumentation (both the
 * swc `refresh` transform and ReactRefreshPlugin's `builtin:react-refresh-
 * loader`) was being applied to node_modules content, including hadars's own
 * compiled dist/index.js (unavoidably pulled into every client entry via
 * hadars's generated wrapper). That file exports a hook-named function
 * (`useServerData`) which the refresh transform instruments as if it were a
 * component/hook — applied to already-bundled output rather than original
 * source, this produced malformed JS and either a hard compile error or a
 * runtime "$RefreshReg$"/"$ReactRefreshRuntime$ is not defined" crash that
 * killed the HMR client's bootstrap before it could ever process an update.
 *
 * This drives a real headless browser against a real `hadars dev` server,
 * edits a component's source file on disk, and asserts the change appears in
 * the DOM without a page reload — i.e. that Fast Refresh actually works, not
 * just that the dev server starts without errors.
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

test('dev server compiles without a React Refresh / node_modules parse error', async () => {
    // The bug this guards against was a hard compile error in the client
    // bundle (see the module header above) — if the dev server started at
    // all with a clean 200, that alone already rules out the failure mode.
    const res = await fetch(BASE_URL + '/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(ORIGINAL_PROBE);
});

test('editing a component hot-updates the browser without a page reload', async () => {
    const page = await browser!.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    const hotUpdateRequests: string[] = [];
    page.on('request', (req) => {
        if (req.url().includes('hot-update')) hotUpdateRequests.push(req.url());
    });

    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
    expect(await page.textContent('#probe')).toBe(ORIGINAL_PROBE);

    // Simulate a live edit.
    const updatedSource = originalAppSource.replace(ORIGINAL_PROBE, UPDATED_PROBE);
    await writeFile(APP_PATH, updatedSource);

    // Poll the DOM — no page.reload() anywhere in this test. If the fix
    // regresses, this loop exhausts its budget and the assertion below fails.
    let current = ORIGINAL_PROBE;
    for (let i = 0; i < 20 && current === ORIGINAL_PROBE; i++) {
        await page.waitForTimeout(500);
        current = (await page.textContent('#probe')) ?? current;
    }

    expect(current).toBe(UPDATED_PROBE);
    expect(hotUpdateRequests.length).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);

    await page.close();
});
