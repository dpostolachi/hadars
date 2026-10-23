import { MODULES_GLOBAL, type TargetManifest } from './constants';

// This file is imported by shell apps whose entry is bundled for the browser as
// well as the server, so node builtins are imported lazily with webpackIgnore:
// the web build leaves them alone and they only run on the server.

const loadedAt = new Map<string, number>();

/**
 * Server side: loads a built module's server bundle. The host must have called
 * `provideShared` first. `dir` is the target directory written by `buildModule`
 * (`<outDir>/server`).
 *
 * A bundle whose file changed since it was last loaded is evaluated again, so
 * a dev rebuild shows up on the next request; an unchanged one stays cached.
 */
export async function loadServerModule(dir: string): Promise<any> {
    const [{ readFile, stat }, { createRequire }, path] = await Promise.all([
        import(/* webpackIgnore: true */ 'node:fs/promises'),
        import(/* webpackIgnore: true */ 'node:module'),
        import(/* webpackIgnore: true */ 'node:path'),
    ]);
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest: TargetManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const file = manifest.js[0];
    if (!file) throw new Error(`No server bundle listed in ${manifestPath}`);
    const full = path.join(dir, file);
    const { mtimeMs } = await stat(full);
    const req = createRequire(full);
    // ESM import() would share CommonJS's cache, so evict it explicitly.
    if (loadedAt.get(full) !== mtimeMs) {
        delete req.cache[full];
        loadedAt.set(full, mtimeMs);
    }
    // A dev rebuild writes the file in place, so a request can catch it half written. That fails
    // to parse (the error type differs by runtime) or the file changes under us; both clear on re-read.
    let seen = mtimeMs;
    for (let attempt = 0; ; attempt++) {
        try {
            return req(full);
        } catch (err: any) {
            const now = (await stat(full)).mtimeMs;
            const moved = now !== seen;
            const parseError = ['SyntaxError', 'BuildMessage'].includes(err?.name) || /unexpected end|found end of file/i.test(String(err?.message));
            if (attempt >= 4 || !(moved || parseError)) throw err;
            seen = now;
            delete req.cache[full];
            loadedAt.set(full, now);
            await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        }
    }
}

export interface LoadClientModuleOptions {
    /** The module's file lists; read from `<baseUrl>/manifest.json` when omitted (one extra round trip). */
    manifest?: TargetManifest;
    /**
     * Sets `crossorigin` on the module's scripts so their errors are readable instead of an opaque
     * "Script error.". The origin must then send CORS headers, so it is off by default.
     */
    crossOrigin?: 'anonymous' | 'use-credentials';
    /** Defaults to the global `document`. */
    doc?: Document;
}

const inFlight = new Map<string, Promise<any>>();

/**
 * Browser side: loads a module's stylesheets, then its scripts, and returns what
 * it registered under `__HADARS_MODULES__[name]`. Stylesheets go first so the
 * module never paints unstyled. Loading the same module twice, even
 * concurrently, runs it once.
 */
export function loadClientModule(name: string, baseUrl: string, options: LoadClientModuleOptions = {}): Promise<any> {
    // Re-read after loading: a bundle may replace the registry object rather than extend it.
    const registered = (): any => (globalThis as any)[MODULES_GLOBAL]?.[name];
    if (registered()) return Promise.resolve(registered());
    const key = `${baseUrl}\0${name}`;
    let pending = inFlight.get(key);
    if (!pending) {
        pending = load(name, baseUrl, options).then(() => {
            if (!registered()) throw new Error(`Module "${name}" did not register itself after loading`);
            return registered();
        }).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
    }
    return pending;
}

async function load(name: string, baseUrl: string, { manifest, crossOrigin, doc = (globalThis as any).document }: LoadClientModuleOptions) {
    const url = (f: string) => baseUrl.replace(/\/?$/, '/') + f;
    if (!manifest) {
        const res = await fetch(url('manifest.json'));
        if (!res.ok) throw new Error(`Could not load the manifest for module "${name}" (${res.status} ${url('manifest.json')})`);
        manifest = await res.json() as TargetManifest;
    }
    const wait = (el: HTMLElement) => new Promise<void>((resolve, reject) => {
        el.addEventListener('load', () => resolve());
        el.addEventListener('error', () => reject(new Error(`Failed to load ${(el as any).href ?? (el as any).src}`)));
        doc.head.appendChild(el);
    });
    const { css, js } = manifest;
    await Promise.all(css.map((f) => {
        if (doc.querySelector(`link[href="${url(f)}"]`)) return;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = url(f);
        return wait(link);
    }));
    for (const f of js) {
        const script = doc.createElement('script');
        script.src = url(f);
        if (crossOrigin) script.crossOrigin = crossOrigin;
        await wait(script);
    }
}
