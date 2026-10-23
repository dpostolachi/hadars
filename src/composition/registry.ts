const modules = new Map<string, any>();

/**
 * Makes a loaded module available to the shell's components. Call it from
 * `getInitProps` on the server and `getClientProps` in the browser, after
 * loading, so the first render (and hydration) finds it synchronously.
 */
export function registerModule(name: string, mod: unknown): void {
    modules.set(name, mod);
}

/** Returns a registered module; throws if it was not loaded before rendering. */
export function useModule<T = any>(name: string): T {
    if (!modules.has(name)) {
        throw new Error(`Module "${name}" is not loaded. Load and register it in getInitProps (server) and getClientProps (browser) before rendering.`);
    }
    return modules.get(name);
}
