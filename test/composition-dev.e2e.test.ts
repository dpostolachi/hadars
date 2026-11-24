/**
 * Working on a module locally: the shell runs `hadars dev`, the module runs its own
 * dev server, and editing the module hot-updates the page without a reload (shell
 * state survives) while the server render picks up the change too.
 *
 * Prerequisites: see composition-shell.e2e.test.ts.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModule } from '../src/composition/build';
import { writePinnedBuilds } from './helpers/pinnedBuilds';
import { startModuleDevServer, type ModuleDevServer } from '../src/composition/dev';

const ROOT = join(import.meta.dir, '..');
const SHELL = join(ROOT, 'test', 'fixtures', 'composition-shell');
const BIN = join(SHELL, 'node_modules', '.bin', 'hadars');
const PORT = 4190;
const BASE = `http://localhost:${PORT}`;
const ready = existsSync(BIN);
const t = ready ? test : test.skip;

let server: ReturnType<typeof Bun.spawn> | undefined;
let browser: Browser | undefined;
let dev: ModuleDevServer | undefined;
let work = '';
let source = '';

const text = (html: string) => html.replace(/<!-- -->/g, '');

beforeAll(async () => {
    if (!ready) return;
    work = mkdtempSync(join(tmpdir(), 'hadars-composition-dev-'));
    cpSync(join(ROOT, 'test', 'fixtures', 'composition-module'), join(work, 'module'), { recursive: true });
    writeFileSync(join(work, 'package.json'), JSON.stringify({ type: 'module' }));
    source = join(work, 'module', 'src', 'index.tsx');
    const pinnedDir = join(SHELL, '.hadars', 'pinned-inputs');
    mkdirSync(join(SHELL, '.hadars', 'types'), { recursive: true });
    writeFileSync(join(SHELL, '.hadars', 'types', 'greeter.d.ts'), 'export {};');
    writeFileSync(join(SHELL, '.hadars', 'tsconfig.json'), '{}');
    const pinnedOut = join(work, 'immutable');
    const targets = await buildModule({ composition: { role: 'module', name: 'greeter', exposes: { greeting: 'src/index.tsx', page: 'src/page.tsx' } }, cwd: join(work, 'module'), outDir: pinnedOut });
    writePinnedBuilds(pinnedDir, pinnedOut, targets);
    dev = await startModuleDevServer({
        composition: { role: 'module', name: 'greeter', exposes: { greeting: 'src/index.tsx', page: 'src/page.tsx' } },
        cwd: join(work, 'module'),
        outDir: join(work, 'out'),
    });
    server = Bun.spawn([BIN, 'dev'], {
        cwd: SHELL,
        env: { ...process.env, PORT: String(PORT), PINNED_DIR: pinnedDir, MODULE_SERVER_DIR: dev.serverDir, MODULE_URL: dev.clientUrl.replace(/\/$/, '') },
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

t('the module dev server answers odd requests without going down', async () => {
    expect((await fetch(dev!.clientUrl)).status).toBe(404);
    expect((await fetch(`${dev!.clientUrl}..%2f..%2fetc/passwd`)).status).toBe(404);
    expect((await fetch(`${dev!.clientUrl}manifest.json`)).status).toBe(200);
});

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


t('dev startup preserves pinned inputs and generated declarations', () => {
    expect(existsSync(join(SHELL, '.hadars', 'pinned-inputs', 'hadars.lock'))).toBe(true);
    expect(readFileSync(join(SHELL, '.hadars', 'types', 'greeter.d.ts'), 'utf8')).toBe('export {};');
    expect(readFileSync(join(SHELL, '.hadars', 'tsconfig.json'), 'utf8')).toBe('{}');
});

test('module dev startup rejects compilation errors and releases its watchers and port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hadars-module-error-'));
    try {
        writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
        writeFileSync(join(dir, 'broken.tsx'), 'export const Broken = <;');
        const options = { cwd: dir, outDir: join(dir, 'out'), port: 4198,
            composition: { role: 'module' as const, name: 'broken', exposes: { page: 'broken.tsx' } } };
        await expect(startModuleDevServer(options)).rejects.toThrow('Initial module compilation failed');
        writeFileSync(join(dir, 'broken.tsx'), 'export const value = 1;');
        const restarted = await startModuleDevServer(options);
        await restarted.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

t('shell dev exits nonzero when its first compilation fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hadars-shell-error-'));
    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
        symlinkSync(join(SHELL, 'node_modules'), join(dir, 'node_modules'), 'dir');
        writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
        writeFileSync(join(dir, 'hadars.config.ts'), "export default { entry: 'App.tsx', port: 4194 };");
        writeFileSync(join(dir, 'App.tsx'), 'export default function App() { return <; }');
        const spawned = Bun.spawn([process.execPath, join(ROOT, 'dist/cli.js'), 'dev'], {
            cwd: dir, stdout: 'pipe', stderr: 'pipe',
        });
        child = spawned;
        const timeout = setTimeout(() => spawned.kill(), 30_000);
        const [code, stdout, stderr] = await Promise.all([spawned.exited, new Response(spawned.stdout).text(), new Response(spawned.stderr).text()]);
        clearTimeout(timeout);
        expect(code).toBe(1);
        expect(stdout + stderr).toContain('compilation failed');
        expect(stdout + stderr).not.toContain('initial-build-complete');
    } finally { child?.kill(); rmSync(dir, { recursive: true, force: true }); }
}, 40_000);

test('dev and build preserve module outputs and user directories while cleaning owned output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hadars-retain-output-'));
    let child: ReturnType<typeof Bun.spawn> | undefined;
    const retained = ['module-output', '.hadars/module-output', '.hadars/static/modules/example', '.hadars/user-staging'];
    const seed = () => {
        for (const name of [...retained, '.hadars/static/obsolete', '.hadars/.ssr-modules/obsolete']) {
            mkdirSync(join(dir, name), { recursive: true });
            writeFileSync(join(dir, name, 'keep.txt'), name);
        }
    };
    const verify = () => {
        for (const name of retained) expect(readFileSync(join(dir, name, 'keep.txt'), 'utf8')).toBe(name);
        expect(existsSync(join(dir, '.hadars/static/obsolete'))).toBe(false);
        expect(existsSync(join(dir, '.hadars/.ssr-modules/obsolete'))).toBe(false);
    };
    try {
        symlinkSync(join(SHELL, 'node_modules'), join(dir, 'node_modules'), 'dir');
        writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
        cpSync(join(SHELL, 'tsconfig.json'), join(dir, 'tsconfig.json'));
        writeFileSync(join(dir, 'App.tsx'), 'export default function App() { return <div>retention fixture</div>; }');
        writeFileSync(join(dir, 'hadars.config.ts'), `export default { entry: 'App.tsx', port: 4196,
            moduleOutputDirs: ${JSON.stringify(retained.slice(0, 3))} };`);
        seed();
        child = Bun.spawn([process.execPath, join(ROOT, 'dist/cli.js'), 'dev'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
        let ready = false;
        for (let i = 0; i < 100; i++) {
            try { if ((await (await fetch('http://localhost:4196')).text()).includes('retention fixture')) { ready = true; break; } } catch {}
            if (child.exitCode !== null) throw new Error(await new Response(child.stdout as ReadableStream).text() + await new Response(child.stderr as ReadableStream).text());
            await Bun.sleep(100);
        }
        expect(ready).toBe(true);
        verify();
        child.kill();
        await child.exited;
        child = undefined;
        seed();
        const built = Bun.spawn([process.execPath, join(ROOT, 'dist/cli.js'), 'build'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
        const [code, stdout, stderr] = await Promise.all([built.exited, new Response(built.stdout).text(), new Response(built.stderr).text()]);
        if (code !== 0) throw new Error(stdout + stderr);
        verify();
    } finally { child?.kill(); rmSync(dir, { recursive: true, force: true }); }
}, 60_000);
