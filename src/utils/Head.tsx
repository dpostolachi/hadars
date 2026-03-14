import React from 'react';
import type { AppContext, AppUnsuspend, LinkProps, MetaProps, ScriptProps, StyleProps } from '../types/hadars'

interface InnerContext {
    setTitle: (title: string) => void;
    addMeta: (id: string, props: MetaProps) => void;
    addLink: (id: string, props: LinkProps) => void;
    addStyle: (id: string, props: StyleProps) => void;
    addScript: (id: string, props: ScriptProps) => void;
    setStatus: (status: number) => void;
}

const AppContext = React.createContext<InnerContext>({
    setTitle: () => {
        console.warn('AppContext: setTitle called outside of provider');
    },
    addMeta: () => {
        console.warn('AppContext: addMeta called outside of provider');
    },
    addLink: () => {
        console.warn('AppContext: addLink called outside of provider');
    },
    addStyle: () => {
        console.warn('AppContext: addStyle called outside of provider');
    },
    addScript: () => {
        console.warn('AppContext: addScript called outside of provider');
    },
    setStatus: () => { },
});

export const AppProviderSSR: React.FC<{
    children: React.ReactNode,
    context: AppContext,
}> = React.memo( ({ children, context }) => {

    const { head } = context;

    // mutate seoData
    const setTitle = React.useCallback((title: string) => {
        head.title = title;
    }, [head]);
    const addMeta = React.useCallback((id: string, props: MetaProps) => {
        head.meta[id] = props;
    }, [head]);
    const addLink = React.useCallback((id: string, props: LinkProps) => {
        head.link[id] = props;
    }, [head]);
    const addStyle = React.useCallback((id: string, props: StyleProps) => {
        head.style[id] = props;
    }, [head]);
    const addScript = React.useCallback((id: string, props: ScriptProps) => {
        head.script[id] = props;
    }, [head]);

    const setStatus = React.useCallback((status: number) => {
        head.status = status;
    }, [head]);

    const contextValue: InnerContext = React.useMemo(() => ({
        setTitle,
        addMeta,
        addLink,
        addStyle,
        addScript,
        setStatus,
    }), [ setTitle, addMeta, addLink, addStyle, addScript, setStatus]);
    return (
        <AppContext.Provider value={contextValue}>
            {children}
        </AppContext.Provider>
    );
} );

export const AppProviderCSR: React.FC<{
    children: React.ReactNode
}> = React.memo( ({ children }) => {

    const setTitle = React.useCallback((title: string) => {
        document.title = title;
    }, []);

    const addMeta = React.useCallback((id: string, props: MetaProps) => {
        let meta = document.querySelector(`#${id}`) as HTMLMetaElement | null;
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('id', id);
            document.head.appendChild(meta);
        }
        Object.keys(props).forEach(key => {
            const value = (props)[key as keyof MetaProps];
            if (value) {
                meta!.setAttribute(key, value);
            }
        });
    }, []);

    const addLink = React.useCallback((id: string, props: LinkProps) => {
        let link = document.querySelector(`#${id}`) as HTMLLinkElement | null;
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('id', id);
            document.head.appendChild(link);
        }
        Object.keys(props).forEach(key => {
            const value = (props)[key as keyof LinkProps];
            if (value) {
                link!.setAttribute(key, value);
            }
        });
    }, []);

    const addStyle = React.useCallback((id: string, props: StyleProps) => {
        let style = document.getElementById(id) as HTMLStyleElement | null;
        if (!style) {
            style = document.createElement('style');
            style.setAttribute('id', id);
            document.head.appendChild(style);
        }
        Object.keys(props).forEach(key => {
            // handle dangerouslySetInnerHTML
            if (key === 'dangerouslySetInnerHTML' && (props as any)[key] && (props as any)[key].__html) {
                style!.innerHTML = (props as any)[key].__html;
                return;
            }
            const value = (props)[key as keyof StyleProps];
            if (value) {
                (style as any)[key] = value;
            }
        });
    }, []);

    const addScript = React.useCallback((id: string, props: ScriptProps) => {
        let script = document.getElementById(id) as HTMLScriptElement | null;
        if (!script) {
            script = document.createElement('script');
            script.setAttribute('id', id);
            document.body.appendChild(script);
        }
        Object.keys(props).forEach(key => {
            // handle dangerouslySetInnerHTML
            if (key === 'dangerouslySetInnerHTML' && (props as any)[key] && (props as any)[key].__html) {
                script!.innerHTML = (props as any)[key].__html;
                return;
            }
            const value = (props)[key as keyof ScriptProps];
            if (value) {
                (script as any)[key] = value;
            }
        });
    }, []);

    const contextValue: InnerContext = React.useMemo(() => ({
        setTitle,
        addMeta,
        addLink,
        addStyle,
        addScript,
        setStatus: () => { },
    }), [setTitle, addMeta, addLink, addStyle, addScript]);

    return (
        <AppContext.Provider value={contextValue}>
            {children}
        </AppContext.Provider>
    );
} );

export const useApp = () => React.useContext(AppContext);

// ── useServerData ─────────────────────────────────────────────────────────────
//
// Client-side cache pre-populated from the server's resolved data before
// hydration. Keyed by the same React useId() values that the server used.
const clientServerDataCache = new Map<string, unknown>();

// Tracks in-flight data-only requests keyed by pathname+search so that all
// useServerData calls within a single Suspense pass share one network request.
const pendingDataFetch = new Map<string, Promise<void>>();
// Paths for which a client data fetch has already completed. Prevents re-fetching
// when a key is genuinely absent from the server response for this path.
const fetchedPaths = new Set<string>();

// Keys that were seeded from SSR data and not yet claimed by any useServerData
// call on the client. Used to detect server↔client key mismatches.
let ssrInitialKeys: Set<string> | null = null;
let unclaimedKeyCheckScheduled = false;

function scheduleUnclaimedKeyCheck() {
    if (unclaimedKeyCheckScheduled) return;
    unclaimedKeyCheckScheduled = true;
    // Wait for the current synchronous hydration pass to finish, then check.
    setTimeout(() => {
        unclaimedKeyCheckScheduled = false;
        if (ssrInitialKeys && ssrInitialKeys.size > 0) {
            console.warn(
                `[hadars] useServerData: ${ssrInitialKeys.size} server-resolved key(s) were ` +
                `never claimed during client hydration: ${[...ssrInitialKeys].map(k => JSON.stringify(k)).join(', ')}. ` +
                `This usually means the key passed to useServerData was different on the server ` +
                `than on the client (e.g. it contains Date.now(), Math.random(), or another ` +
                `value that changes between renders). Keys must be stable and deterministic.`,
            );
        }
        ssrInitialKeys = null;
    }, 0);
}

/** Call this before hydrating to seed the client cache from the server's data.
 *  Invoked automatically by the hadars client bootstrap.
 *  Always clears the existing cache before populating — call with `{}` to just clear. */
export function initServerDataCache(data: Record<string, unknown>) {
    clientServerDataCache.clear();
    ssrInitialKeys = new Set<string>();
    for (const [k, v] of Object.entries(data)) {
        clientServerDataCache.set(k, v);
        ssrInitialKeys.add(k);
    }
}

/**
 * Fetch async data on the server during SSR. Returns `undefined` on the first
 * render pass(es) while the promise is in flight; returns the resolved value
 * once the framework's render loop has awaited it.
 *
 * On the client the pre-resolved value is read from the hydration cache
 * serialised into the page by the server, so no fetch is issued in the browser.
 *
 * The `key` (string or array of strings) uniquely identifies the cached value
 * across all SSR render passes and client hydration — it must be stable and
 * unique within the page.
 *
 * `fn` may return a `Promise<T>` (async usage) or return `T` synchronously.
 * The resolved value is serialised into `__serverData` and returned from cache
 * during hydration.
 *
 * `fn` is **server-only**: it is never called in the browser. On client-side
 * navigation (after the initial SSR load), hadars automatically fires a
 * data-only request to the current URL (`X-Hadars-Data: 1`) and suspends via
 * React Suspense until the server returns the JSON map of resolved values.
 *
 * @example
 * const user = useServerData('current_user', () => db.getUser(id));
 * const post = useServerData(['post', postId], () => db.getPost(postId));
 * if (!user) return null; // undefined while pending on the first SSR pass
 */
export function useServerData<T>(key: string | string[], fn: () => Promise<T> | T): T | undefined {
    const cacheKey = Array.isArray(key) ? JSON.stringify(key) : key;

    if (typeof window !== 'undefined') {
        // Cache hit — return the server-resolved value directly (covers both initial
        // SSR hydration and values fetched during client-side navigation).
        if (clientServerDataCache.has(cacheKey)) {
            // Mark this SSR key as claimed so the unclaimed-key check doesn't warn about it.
            ssrInitialKeys?.delete(cacheKey);
            return clientServerDataCache.get(cacheKey) as T;
        }

        // Cache miss during the initial hydration pass (SSR data is present but
        // this key wasn't in it) — schedule a deferred check for orphaned SSR keys
        // which would signal a server↔client key mismatch.
        if (ssrInitialKeys !== null && ssrInitialKeys.size > 0) {
            scheduleUnclaimedKeyCheck();
        }

        // Cache miss — this component is mounting during client-side navigation
        // (the server hasn't sent data for this path yet). Fire a data-only
        // request to the server at the current URL and suspend via React Suspense
        // until it completes. All useServerData calls within the same React render
        // share one Promise so only one network request is made per navigation.
        const pathKey = window.location.pathname + window.location.search;

        // If we already fetched this path and the key is still missing, the server
        // doesn't produce a value for it — return undefined rather than looping.
        if (fetchedPaths.has(pathKey)) {
            return undefined;
        }

        if (!pendingDataFetch.has(pathKey)) {
            let resolve!: () => void;
            const p = new Promise<void>(res => { resolve = res; });
            pendingDataFetch.set(pathKey, p);
            // Fire in a microtask so that every useServerData call in this React
            // render is registered against the same deferred before the fetch starts.
            queueMicrotask(async () => {
                try {
                    const res = await fetch(pathKey, {
                        headers: { 'Accept': 'application/json' },
                    });
                    if (res.ok) {
                        const json = await res.json() as { serverData: Record<string, unknown> };
                        for (const [k, v] of Object.entries(json.serverData ?? {})) {
                            clientServerDataCache.set(k, v);
                        }
                    }
                } finally {
                    fetchedPaths.add(pathKey);
                    pendingDataFetch.delete(pathKey);
                    resolve();
                }
            });
        }
        throw pendingDataFetch.get(pathKey)!;
    }

    // Server: communicate via globalThis.__hadarsUnsuspend which is set by the
    // framework around every renderToStaticMarkup / renderToString call. Using
    // globalThis bypasses React context identity issues that arise when the user's
    // SSR bundle and the hadars source each have their own React context instance.
    const unsuspend: AppUnsuspend | undefined = (globalThis as any).__hadarsUnsuspend;
    if (!unsuspend) return undefined;

    // ── per-pass key tracking ────────────────────────────────────────────────
    // We keep two sets: keys seen in the current pass and keys seen in the
    // previous pass.  When a pass throws a promise, the *next* call to
    // useServerData marks the start of a new pass and rotates the sets.
    //
    // A key is unstable when a key that WAS seen in the previous pass is now
    // absent from the current pass while a new key appears instead.  This means
    // a component produced a different key string between passes (e.g. Date.now()
    // in the key).  We fire immediately — there is no need to wait for other
    // entries to settle first, because a legitimately-new component always extends
    // seenLastPass (all previous keys remain present in seenThisPass).
    const _u = unsuspend as any;
    if (!_u.seenThisPass) _u.seenThisPass = new Set<string>();
    if (!_u.seenLastPass) _u.seenLastPass = new Set<string>();

    if (_u.newPassStarting) {
        // This is the first useServerData call after a thrown promise — rotate.
        _u.seenLastPass = new Set(_u.seenThisPass);
        _u.seenThisPass.clear();
        _u.newPassStarting = false;
    }
    _u.seenThisPass.add(cacheKey);
    // ────────────────────────────────────────────────────────────────────────

    const existing = unsuspend.cache.get(cacheKey);

    if (!existing) {
        // Detect an unstable key: a key that was called in the previous pass is
        // now absent while a new key has appeared.  This means a component
        // generated a different key between passes — it will loop forever.
        //
        // We intentionally do NOT fire when seenLastPass is empty (first pass
        // ever) or when all previous keys are still present (legitimate
        // "new component reached for the first time" scenario).
        if (_u.seenLastPass.size > 0) {
            const hasVanishedKey = [..._u.seenLastPass as Set<string>].some(
                (k: string) => !(_u.seenThisPass as Set<string>).has(k),
            );
            if (hasVanishedKey) {
                throw new Error(
                    `[hadars] useServerData: key ${JSON.stringify(cacheKey)} appeared in this pass ` +
                    `but a key that was present in the previous pass is now missing. This means ` +
                    `the key is not stable across render passes (e.g. it contains Date.now(), ` +
                    `Math.random(), or a value that changes on every render). Keys must be deterministic.`,
                );
            }
        }

        // First encounter — call fn(), which may:
        //   (a) return a Promise<T>  — async usage (serialised for the client)
        //   (b) return T synchronously — e.g. a sync data source
        const result = fn();

        const isThenable = result !== null && typeof result === 'object' && typeof (result as any).then === 'function';

        // (b) Synchronous return — store as fulfilled and return immediately.
        if (!isThenable) {
            const value = result as T;
            unsuspend.cache.set(cacheKey, { status: 'fulfilled', value });
            return value;
        }

        // (a) Async Promise — standard useServerData usage.
        const promise = (result as Promise<T>).then(
            value => { unsuspend.cache.set(cacheKey, { status: 'fulfilled', value }); },
            reason => { unsuspend.cache.set(cacheKey, { status: 'rejected', reason }); },
        );
        unsuspend.cache.set(cacheKey, { status: 'pending', promise });
        _u.newPassStarting = true; // next useServerData call opens a new pass
        throw promise; // slim-react will await and retry
    }
    if (existing.status === 'pending') {
        _u.newPassStarting = true;
        throw existing.promise; // slim-react will await and retry
    }
    if (existing.status === 'rejected') throw existing.reason;
    return existing.value as T;
}


const genRandomId = () => {
    return 'head-' + Math.random().toString(36).substr(2, 9);
}

export const Head: React.FC<{
    children?: React.ReactNode;
    status?: number;
}> = React.memo( ({ children, status }) => {

    const {
        setStatus,
        setTitle,
        addMeta,
        addLink,
        addStyle,
        addScript,
    } = useApp();

    if ( status ) {
        setStatus(status);
    }

    React.Children.forEach(children, ( child ) => {
        if ( !React.isValidElement(child) ) return;

        const childType = child.type;
        // React 19 types element.props as unknown; cast here since we
        // inspect props dynamically based on the element type below.
        const childProps = child.props as Record<string, any>;
        const id = childProps['id'] || genRandomId();

        switch ( childType ) {
            case 'title': {
                setTitle(childProps['children'] as string);
                return;
            }
            case 'meta': {
                addMeta(id.toString(), childProps as MetaProps);
                return;
            }
            case 'link': {
                addLink(id.toString(), childProps as LinkProps);
                return;
            }
            case 'script': {
                addScript(id.toString(), childProps as ScriptProps);
                return;
            }
            case 'style': {
                addStyle(id.toString(), childProps as StyleProps);
                return;
            }
            default: {
                console.warn(`HadarsHead: Unsupported child type: ${childType}`);
                return;
            }
        }
    });

    return null;
} );
