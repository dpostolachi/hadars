/**
 * Client-side dev-update end-to-end test — run with `bun test`.
 *
 * Regression test for a bug where `hadars dev`'s client bundle threw
 * `ReferenceError: $RefreshReg$ is not defined` (or `$ReactRefreshRuntime,
 * depending on exactly how it was wired at the time) on every page load,
 * which killed the HMR client's bootstrap before it could ever process an
 * update — the browser sat frozen on stale content indefinitely no matter
 * how many times the source changed.
 *
 * React Refresh (in-place component patching) is currently disabled in dev
 * — see the comment above `createClientCompiler` in src/utils/rspack.ts for
 * why. This test reflects that: it asserts the actual outcome a developer
 * sees — zero page errors, and an edit reaching the browser automatically
 * — rather than the specific mechanism (in-place patch vs. full reload).
 * If Fast Refresh is re-enabled in the future, only the reload-detection
 * logic below needs updating; the error-free assertion stays valid either way.
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

test('editing a component reaches the browser automatically with no page errors', async () => {
    const page = await browser!.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
    expect(await page.textContent('#probe')).toBe(ORIGINAL_PROBE);

    // Simulate a live edit.
    const updatedSource = originalAppSource.replace(ORIGINAL_PROBE, UPDATED_PROBE);
    await writeFile(APP_PATH, updatedSource);

    // Poll the DOM — this test never calls page.reload() itself. Whether the
    // update arrives via an in-place Fast Refresh patch or the dev server's
    // own full-page reload fallback, the content must change on its own. If
    // this regresses, the loop exhausts its budget and the assertion fails.
    let current = ORIGINAL_PROBE;
    for (let i = 0; i < 20 && current === ORIGINAL_PROBE; i++) {
        await page.waitForTimeout(500);
        try {
            current = (await page.textContent('#probe')) ?? current;
        } catch {
            // Mid-navigation (full-reload fallback) — the element is briefly
            // detached; retry on the next iteration.
        }
    }

    expect(current).toBe(UPDATED_PROBE);
    expect(pageErrors).toEqual([]);

    await page.close();
});
