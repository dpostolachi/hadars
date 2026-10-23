/**
 * Working on a module locally: the shell runs `hadars dev`, the module runs its own
 * dev server, and editing the module hot-updates the page without a reload (shell
 * state survives) while the server render picks up the change too.
 *
 * Prerequisites: see composition-shell.e2e.test.ts.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startModuleDev, type ModuleDev } from '../src/composition/dev';

const ROOT = join(import.meta.dir, '..');
const SHELL = join(ROOT, 'test', 'fixtures', 'composition-shell');
const BIN = join(SHELL, 'node_modules', '.bin', 'hadars');
const PORT = 4190;
const BASE = `http://localhost:${PORT}`;
const ready = existsSync(BIN);
const t = ready ? test : test.skip;

let server: ReturnType<typeof Bun.spawn> | undefined;
let browser: Browser | undefined;
let dev: ModuleDev | undefined;
let work = '';
let source = '';

const text = (html: string) => html.replace(/<!-- -->/g, '');

beforeAll(async () => {
    if (!ready) return;
    work = mkdtempSync(join(tmpdir(), 'hadars-composition-dev-'));
    cpSync(join(ROOT, 'test', 'fixtures', 'composition-module'), join(work, 'module'), { recursive: true });
    source = join(work, 'module', 'src', 'index.tsx');
    dev = await startModuleDev({
        composition: { role: 'module', name: 'greeter', exposes: { greeting: 'src/index.tsx', page: 'src/page.tsx' } },
        cwd: join(work, 'module'),
        outDir: join(work, 'out'),
    });
    server = Bun.spawn([BIN, 'dev'], {
        cwd: SHELL,
        env: { ...process.env, PORT: String(PORT), MODULE_SERVER_DIR: dev.serverDir, MODULE_URL: dev.url.replace(/\/$/, '') },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    for (let i = 0; i < 150; i++) {
        try { if ((await fetch(BASE)).status < 500) break; } catch {}
        await Bun.sleep(200);
    }
    browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
    await browser?.close();
    server?.kill();
    await dev?.close();
    if (work) rmSync(work, { recursive: true, force: true });
    rmSync(join(SHELL, '.hadars'), { recursive: true, force: true });
});

const edit = (file: string, from: string, to: string) => writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));

t('editing a component hot-updates the page and keeps the shell state', async () => {
    const page = await browser!.newPage();
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.goto(BASE);
    await page.waitForFunction(() => (globalThis as any).__HADARS_MODULES__?.greeter);
    expect(text(await page.content())).toContain('hello host n=2');

    await page.click('#inc');
    await page.click('#inc');
    await page.waitForFunction(() => document.querySelector('#inc')?.textContent === 'shell count 2');

    edit(join(work, 'module', 'src', 'tag.tsx'), 'tag-a', 'tag-b');
    await page.waitForFunction(() => document.querySelector('#tag')?.textContent === 'tag-b', undefined, { timeout: 30_000 });

    // A reload would reset this to 0: the update was applied in place.
    expect(await page.textContent('#inc')).toBe('shell count 2');
    expect(await page.evaluate(() => (globalThis as any).__hadarsModuleHmrError)).toBeUndefined();
    expect(problems).toEqual([]);
    await page.close();
}, 60_000);

t('an edit no component boundary accepts falls back to a reload', async () => {
    const page = await browser!.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => (globalThis as any).__HADARS_MODULES__?.greeter);
    await page.click('#inc');
    await page.waitForFunction(() => document.querySelector('#inc')?.textContent === 'shell count 1');

    // index.tsx also exports a context, so it is not a refresh boundary.
    edit(join(work, 'module', 'src', 'index.tsx'), 'hello', 'howdy');
    await page.waitForFunction(() => document.body.textContent?.includes('howdy'), undefined, { timeout: 30_000 });

    expect(await page.textContent('#inc')).toBe('shell count 0');
    await page.close();
}, 60_000);

t('the server render serves the edited module on the next request', async () => {
    // The server bundle is rebuilt in the background, so give it a moment.
    let html = '';
    for (let i = 0; i < 50 && !html.includes('howdy host n=2'); i++) {
        html = text(await (await fetch(BASE)).text());
        if (!html.includes('howdy host n=2')) await Bun.sleep(300);
    }
    expect(html).toContain('howdy host n=2');
    expect(html).toContain('tag-b');
}, 30_000);
