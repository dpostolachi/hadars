/**
 * A hadars shell composes a separately built module: SSR through the real server,
 * then hydration in a browser.
 *
 * Prerequisites (same as hmr.e2e.test.ts):
 *   bun run build:all
 *   cd test/fixtures/composition-shell && npm install
 *   npx playwright install --with-deps chromium
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePinnedBuilds } from './helpers/pinnedBuilds';
import { buildModule } from '../src/composition/build';

const ROOT = join(import.meta.dir, '..');
const SHELL = join(ROOT, 'test', 'fixtures', 'composition-shell');
const MODULE = join(ROOT, 'test', 'fixtures', 'composition-module');
const BIN = join(SHELL, 'node_modules', '.bin', 'hadars');
const PORT = 4185;
const BASE = `http://localhost:${PORT}`;
const ready = existsSync(BIN);
const t = ready ? test : test.skip;

let server: ReturnType<typeof Bun.spawn> | undefined;
let browser: Browser | undefined;
let outDir = '';
let buildId = '';

const text = (html: string) => html.replace(/<!-- -->/g, '');

beforeAll(async () => {
    if (!ready) return;
    outDir = mkdtempSync(join(tmpdir(), 'hadars-composition-e2e-'));
    const sourceDir = join(outDir, 'source');
    cpSync(MODULE, sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'src/style.css'), '#shell { color: rgb(12, 34, 56); }');
    appendFileSync(join(sourceDir, 'src/index.tsx'), "\nimport './style.css';\n");
    const targets = await buildModule({
        composition: { role: 'module', name: 'greeter', exposes: { greeting: 'src/index.tsx', page: 'src/page.tsx' } },
        cwd: sourceDir,
        outDir,
    });
    buildId = writePinnedBuilds(outDir, outDir, targets).buildId;
    for (const dir of ['source', 'client', 'server']) rmSync(join(outDir, dir), { recursive: true });
    const env = { ...process.env, PINNED_DIR: outDir, PORT: String(PORT) };
    const build = Bun.spawn([BIN, 'build'], { cwd: SHELL, env, stdout: 'pipe', stderr: 'pipe' });
    if ((await build.exited) !== 0) throw new Error(await new Response(build.stderr).text());
    server = Bun.spawn([BIN, 'run'], { cwd: SHELL, env, stdout: 'pipe', stderr: 'pipe' });
    for (let i = 0; i < 100; i++) {
        try { if ((await fetch(BASE)).status < 500) break; } catch {}
        await Bun.sleep(200);
    }
    browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
    await browser?.close();
    server?.kill();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
    rmSync(join(SHELL, '.hadars'), { recursive: true, force: true });
});

t('the server renders the module with the shell context', async () => {
    const html = text(await (await fetch(BASE)).text());
    expect(html).toContain('<h1 id="shell">shell</h1>');
    expect(html).toContain('hello host n=2');
});

t('pinned module assets carry SRI in SSR and are served without source', async () => {
    const html = await (await fetch(BASE)).text();
    expect(html).toContain('integrity="sha256-');
    expect(html).toContain('crossorigin="anonymous"');
    expect((await fetch(`${BASE}/_builds/${buildId}/client/greeter.js`)).headers.get('content-type')).toContain('javascript');
    expect((await fetch(`${BASE}/_builds/${buildId}/server/greeter.cjs`)).status).toBe(404);
});

t('the browser loads the module before hydrating and stays interactive', async () => {
    const page = await browser!.newPage();
    const problems: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.goto(BASE);
    await page.waitForFunction(() => (globalThis as any).__HADARS_MODULES__?.greeter);
    await page.click('#inc');
    await page.waitForFunction(() => document.querySelector('#inc')?.textContent === 'shell count 1');
    expect(text(await page.content())).toContain('hello host n=2');
    expect(await page.locator('#shell').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(12, 34, 56)');
    // The module's state works too, so it runs against the shell's React.
    expect(problems).toEqual([]);
    await page.close();
}, 30_000);


t('the browser rejects a tampered pinned script using SRI', async () => {
    const page = await browser!.newPage();
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/client/greeter.js', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()) + '\nglobalThis.tampered = true;' });
    });
    await page.goto(BASE);
    await page.waitForFunction(() => !(globalThis as any).__HADARS_MODULES__?.greeter && document.readyState === 'complete');
    expect(await page.evaluate(() => (globalThis as any).tampered)).toBeUndefined();
    expect(errors.some((e) => /integrity|digest/i.test(e))).toBe(true);
    await page.close();
}, 30_000);


t('the browser rejects a tampered pinned stylesheet using SRI', async () => {
    const page = await browser!.newPage();
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/client/*.css', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: '#shell { color: rgb(200, 0, 0); }' });
    });
    await page.goto(BASE);
    expect(await page.locator('#shell').evaluate((el) => getComputedStyle(el).color)).not.toBe('rgb(200, 0, 0)');
    expect(errors.some((e) => /integrity|digest/i.test(e))).toBe(true);
    await page.close();
}, 30_000);
