import { MODULES_GLOBAL, type TargetManifest } from './constants';

export interface LoadClientModuleOptions {
    /** The module's file lists; read from `<baseUrl>/manifest.json` when omitted (one extra round trip). */
    manifest?: TargetManifest;
    /** File paths relative to baseUrl mapped to SRI values. */
    integrity?: Record<string, string>;
    /**
     * Sets `crossorigin` on the module's scripts so their errors are readable instead of an opaque
     * "Script error.". The origin must then send CORS headers, so it is off by default.
     */
    crossOrigin?: 'anonymous' | 'use-credentials';
    /** Defaults to the global `document`. */
    document?: Document;
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

async function load(name: string, baseUrl: string, { manifest, integrity, crossOrigin, document = (globalThis as any).document }: LoadClientModuleOptions) {
    const url = (f: string) => baseUrl.replace(/\/?$/, '/') + f.split('/').map(encodeURIComponent).join('/');
    if (!manifest) {
        const res = await fetch(url('manifest.json'));
        if (!res.ok) throw new Error(`Could not load the manifest for module "${name}" (${res.status} ${url('manifest.json')})`);
        manifest = await res.json() as TargetManifest;
    }
    const wait = (el: HTMLElement) => new Promise<void>((resolve, reject) => {
        el.addEventListener('load', () => resolve());
        el.addEventListener('error', () => reject(new Error(`Failed to load ${(el as any).href ?? (el as any).src}`)));
        document.head.appendChild(el);
    });
    const { css, js } = manifest;
    await Promise.all(css.map((f) => {
        if (document.querySelector(`link[href="${url(f)}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url(f);
        if (integrity?.[f]) { link.integrity = integrity[f]; link.crossOrigin = crossOrigin ?? 'anonymous'; }
        return wait(link);
    }));
    for (const f of js) {
        const script = document.createElement('script');
        script.src = url(f);
        if (integrity?.[f]) script.integrity = integrity[f];
        if (crossOrigin || integrity?.[f]) script.crossOrigin = crossOrigin ?? 'anonymous';
        await wait(script);
    }
}
