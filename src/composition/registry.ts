// The shell and generated link entry may have separate bundler runtimes.
const state = () => (globalThis as any).__HADARS_SERVER_MODULE_STATE__ ??=
    { modules: new Map<string, any>(), loaders: new Map<string, () => unknown>() };

/** Registers a statically linked bundle without evaluating it before shared providers exist. */
export function registerLinkedModule(name: string, load: () => unknown): void {
    state().modules.delete(name);
    state().loaders.set(name, load);
}

/**
 * Makes a loaded module available to the shell's components. Call it from
 * `getInitProps` on the server and `getClientProps` in the browser, after
 * loading, so the first render (and hydration) finds it synchronously.
 */
export function registerModule(name: string, mod: unknown): void {
    state().modules.set(name, mod);
    state().loaders.delete(name);
}

/** Returns a registered module; throws if it was not loaded before rendering. Not a hook: it may be called anywhere. */
export function getModule<T = any>(name: string): T {
    const { modules, loaders } = state();
    if (!modules.has(name) && loaders.has(name)) registerModule(name, loaders.get(name)!());
    if (!modules.has(name)) {
        throw new Error(`Module "${name}" is not loaded. Load and register it in getInitProps (server) and getClientProps (browser) before rendering.`);
    }
    return modules.get(name);
}
