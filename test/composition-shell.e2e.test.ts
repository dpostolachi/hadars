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
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModule } from '../src/composition/build';

const ROOT = join(import.meta.dir, '..');
const SHELL = join(ROOT, 'test', 'fixtures', 'composition-shell');
const MODULE = join(ROOT, 'test', 'fixtures', 'composition-module');
const BIN = join(SHELL, 'node_modules', '.bin', 'hadars');
const PORT = 4180;
const BASE = `http://localhost:${PORT}`;
const ready = existsSync(BIN);
const t = ready ? test : test.skip;

let server: ReturnType<typeof Bun.spawn> | undefined;
let browser: Browser | undefined;
let outDir = '';

const text = (html: string) => html.replace(/<!-- -->/g, '');

beforeAll(async () => {
    if (!ready) return;
    outDir = mkdtempSync(join(tmpdir(), 'hadars-composition-e2e-'));
    await buildModule({
        composition: { role: 'module', name: 'greeter', exposes: { greeting: 'src/index.tsx', page: 'src/page.tsx' } },
        cwd: MODULE,
        outDir,
    });
    const env = { ...process.env, MODULE_DIR: outDir, PORT: String(PORT) };
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

t('the module files are served from the shell origin', async () => {
    const manifest = await (await fetch(`${BASE}/w/greeter/manifest.json`)).json();
    expect(manifest.js).toEqual(['greeter.js']);
    expect((await fetch(`${BASE}/w/greeter/greeter.js`)).headers.get('content-type')).toContain('javascript');
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
    // The module's state works too, so it runs against the shell's React.
    expect(problems).toEqual([]);
    await page.close();
}, 30_000);
