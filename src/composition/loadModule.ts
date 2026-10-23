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
    return req(full);
}

/**
 * Browser side: loads a module's stylesheets, then its scripts, and returns what
 * it registered under `__HADARS_MODULES__[name]`. Stylesheets go first so the
 * module never paints unstyled. Loading the same module twice is a no-op.
 * `manifest` is read from `<baseUrl>/manifest.json` when not given.
 */
export async function loadClientModule(
    name: string,
    baseUrl: string,
    manifest?: TargetManifest,
    doc: Document = (globalThis as any).document,
): Promise<any> {
    // Re-read after loading: a bundle may replace the registry object rather than extend it.
    const registered = (): any => (globalThis as any)[MODULES_GLOBAL]?.[name];
    if (registered()) return registered();
    const url = (f: string) => baseUrl.replace(/\/?$/, '/') + f;
    // Without a manifest the module's own manifest.json is fetched, one extra round trip.
    manifest ??= await (await fetch(url('manifest.json'))).json();
    const wait = (el: HTMLElement) => new Promise<void>((resolve, reject) => {
        el.addEventListener('load', () => resolve());
        el.addEventListener('error', () => reject(new Error(`Failed to load ${(el as any).href ?? (el as any).src}`)));
        doc.head.appendChild(el);
    });
    await Promise.all(manifest!.css.map((f) => {
        if (doc.querySelector(`link[href="${url(f)}"]`)) return;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = url(f);
        return wait(link);
    }));
    for (const f of manifest!.js) {
        const script = doc.createElement('script');
        script.src = url(f);
        // Without this a cross-origin script's errors reach the page as an opaque "Script error."
        script.crossOrigin = 'anonymous';
        await wait(script);
    }
    if (!registered()) throw new Error(`Module "${name}" did not register itself after loading`);
    return registered();
}
