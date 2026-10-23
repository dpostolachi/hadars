import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODULES_GLOBAL, type TargetManifest } from './moduleBuild';

/**
 * Server side: loads a built module's server bundle. The host must have called
 * `provideShared` first. `dir` is the target directory written by `buildModule`
 * (`<outDir>/server`).
 */
export async function loadServerModule(dir: string): Promise<any> {
    const manifest: TargetManifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const file = manifest.js[0];
    if (!file) throw new Error(`No server bundle listed in ${path.join(dir, 'manifest.json')}`);
    // webpackIgnore keeps the shell's own bundler from trying to resolve the path.
    const ns = await import(/* webpackIgnore: true */ pathToFileURL(path.join(dir, file)).href);
    // CommonJS bundles surface as the default export under ESM interop.
    return ns.default && typeof ns.default === 'object' ? ns.default : ns;
}

/**
 * Browser side: loads a module's stylesheets, then its scripts, and returns what
 * it registered under `__HADARS_MODULES__[name]`. Stylesheets go first so the
 * module never paints unstyled. Loading the same module twice is a no-op.
 */
export async function loadClientModule(
    name: string,
    manifest: TargetManifest,
    baseUrl: string,
    doc: Document = (globalThis as any).document,
): Promise<any> {
    // Re-read after loading: a bundle may replace the registry object rather than extend it.
    const registered = (): any => (globalThis as any)[MODULES_GLOBAL]?.[name];
    if (registered()) return registered();
    const url = (f: string) => baseUrl.replace(/\/?$/, '/') + f;
    const wait = (el: HTMLElement) => new Promise<void>((resolve, reject) => {
        el.addEventListener('load', () => resolve());
        el.addEventListener('error', () => reject(new Error(`Failed to load ${(el as any).href ?? (el as any).src}`)));
        doc.head.appendChild(el);
    });
    await Promise.all(manifest.css.map((f) => {
        if (doc.querySelector(`link[href="${url(f)}"]`)) return;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = url(f);
        return wait(link);
    }));
    for (const f of manifest.js) {
        const script = doc.createElement('script');
        script.src = url(f);
        await wait(script);
    }
    if (!registered()) throw new Error(`Module "${name}" did not register itself after loading`);
    return registered();
}
