import React from 'react';

/**
 * Module registry behind `loadModule()` and `lazy()`.
 *
 * The rspack loader rewrites every `loadModule('./x')` call site to
 * `__hadarsLoadModule(id, load)`, and (browser build only) registers
 * `__hadarsRegisterModule(id, load)` at module scope so the entry can fetch a
 * chunk by id before any component has asked for it.
 *
 * During SSR each load that a render performs is recorded in the request's
 * `__hadarsUnsuspend` cache under `MODULE_KEY_PREFIX + id`. That cache is already
 * serialised into the page, so the browser learns which chunks the server HTML
 * needs and `preloadModules()` fetches them before `hydrateRoot`. Hydration then
 * renders `lazy()` components synchronously instead of suspending.
 */

export const MODULE_KEY_PREFIX = '__hadarsModule:';

type Tracked = Promise<any> & { status?: 'pending' | 'fulfilled' | 'rejected'; value?: any };

const g = globalThis as any;
// One registry per process, shared by every copy of this module (a bundle and a test can both load it).
const shared: { loaders: Map<string, () => Promise<any>>; loaded: Map<string, Tracked> } = g.__hadarsModules ??= { loaders: new Map(), loaded: new Map() };
const loaders = shared.loaders;
// Keyed by id AND the loader's source text. Each render creates a new loader closure, so identity
// cannot be the key; source text is stable for unchanged code and changes when a module is edited,
// which keeps hot updates from serving the previous module and keeps apps in one process apart.
const loaded = shared.loaded;

function load(id: string, loader: () => Promise<any>): Tracked {
    // Server render: remember that this request's HTML needed the module.
    g.__hadarsUnsuspend?.cache.set(MODULE_KEY_PREFIX + id, { status: 'fulfilled', value: true });

    const key = id + '\u0000' + loader.toString();
    let p = loaded.get(key);
    if (!p) {
        const tracked: Tracked = loader().then(
            (mod) => { tracked.status = 'fulfilled'; tracked.value = mod; return mod; },
            (err) => { loaded.delete(key); throw err; },
        );
        tracked.status = 'pending';
        loaded.set(key, tracked);
        p = tracked;
    }
    return p;
}

g.__hadarsRegisterModule = (id: string, loader: () => Promise<any>) => { loaders.set(id, loader); };
g.__hadarsLoadModule = load;

/** Fetch the chunks the server render used. Failures are ignored: the lazy
 *  component simply suspends and retries as it would without a preload. */
export async function preloadModules(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => {
        const loader = loaders.get(id);
        return loader ? load(id, loader).catch(() => {}) : undefined;
    }));
}

/**
 * `React.lazy` that renders synchronously once its module has been loaded, so a
 * hydrating tree never suspends for a chunk that was preloaded. `pick` selects a
 * named export; without it the module's `default` is used.
 *
 *   const Page = lazy(() => loadModule('./Page'));
 *   const Tab  = lazy(() => loadModule('./Tabs'), (m) => m.Tab);
 */
export function lazy<M = any, P = any>(
    factory: () => Promise<M>,
    pick: (mod: M) => React.ComponentType<P> = (mod: any) => mod.default,
): React.ComponentType<P> {
    const Lazy = React.lazy(() => factory().then((mod) => ({ default: pick(mod) })));
    return function HadarsLazy(props: P) {
        const probe = factory() as Tracked;
        if (probe.status === 'fulfilled') {
            return React.createElement(pick(probe.value) as React.ComponentType<any>, props as any);
        }
        return React.createElement(Lazy as React.ComponentType<any>, props as any);
    };
}
