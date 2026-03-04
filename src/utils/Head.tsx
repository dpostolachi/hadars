import React from 'react';
import type { AppContext, AppUnsuspend, LinkProps, MetaProps, ScriptProps, StyleProps } from '../types/ninety'

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

/** Call this before hydrating to seed the client cache from the server's data.
 *  Invoked automatically by the hadars client bootstrap.
 *  Always clears the existing cache before populating — call with `{}` to just clear. */
export function initServerDataCache(data: Record<string, unknown>) {
    clientServerDataCache.clear();
    for (const [k, v] of Object.entries(data)) {
        clientServerDataCache.set(k, v);
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
 * `fn` may return a `Promise<T>` (normal async usage), return `T` synchronously,
 * or throw a thenable (React Suspense protocol). All three cases are handled:
 * - Async `Promise<T>`: awaited across render iterations, result cached.
 * - Synchronous return: value stored immediately, returned on the same pass.
 * - Thrown thenable (e.g. `useQuery({ suspense: true })`): the thrown promise is
 *   awaited, the cache entry is then cleared so that the next render re-calls
 *   `fn()` — at that point the Suspense hook returns synchronously.
 *
 * @example
 * const user = useServerData('current_user', () => db.getUser(id));
 * const post = useServerData(['post', postId], () => db.getPost(postId));
 * if (!user) return null; // undefined while pending on the first SSR pass
 */
export function useServerData<T>(key: string | string[], fn: () => Promise<T> | T): T | undefined {
    const cacheKey = Array.isArray(key) ? JSON.stringify(key) : key;

    if (typeof window !== 'undefined') {
        // Client: if the server serialised a value for this key, return it directly
        // (normal async case — no re-fetch in the browser).
        if (clientServerDataCache.has(cacheKey)) {
            return clientServerDataCache.get(cacheKey) as T | undefined;
        }
        // Key not serialised → Suspense hook case (e.g. useSuspenseQuery).
        // Call fn() directly so the hook runs with its own hydrated cache.
        return fn() as T | undefined;
    }

    // Server: communicate via globalThis.__hadarsUnsuspend which is set by the
    // framework around every renderToStaticMarkup / renderToString call. Using
    // globalThis bypasses React context identity issues that arise when the user's
    // SSR bundle and the hadars source each have their own React context instance.
    const unsuspend: AppUnsuspend | undefined = (globalThis as any).__hadarsUnsuspend;
    if (!unsuspend) return undefined;

    const existing = unsuspend.cache.get(cacheKey);

    // Suspense promise has resolved — re-call fn() so the hook returns its value
    // synchronously from its own internal cache. Cache the result as
    // 'suspense-cached' so later renders (e.g. the final renderToString in
    // buildSsrResponse, which runs after getFinalProps may have cleared the
    // user's QueryClient) can return the value without calling fn() again.
    // NOT stored as 'fulfilled' so it is never included in serverData sent to
    // the client — the Suspense library owns its own hydration.
    if (existing?.status === 'suspense-resolved') {
        try {
            const value = fn() as T;
            unsuspend.cache.set(cacheKey, { status: 'suspense-cached', value });
            return value;
        } catch {
            return undefined;
        }
    }

    // Return the cached Suspense value on all subsequent renders.
    if (existing?.status === 'suspense-cached') {
        return existing.value as T;
    }

    if (!existing) {
        // First encounter — call fn(), which may:
        //   (a) return a Promise<T>  — normal async usage (serialised for the client)
        //   (b) return T synchronously — e.g. a sync data source
        //   (c) throw a thenable     — Suspense protocol (e.g. useSuspenseQuery)
        let result: Promise<T> | T;
        try {
            result = fn();
        } catch (thrown) {
            // (c) Suspense protocol: fn() threw a thenable. Await it, then mark the
            // entry as 'suspense-resolved' so the next render re-calls fn() to get
            // the synchronously available value. Not stored as 'fulfilled' → not
            // serialised to the client (the Suspense library handles its own hydration).
            if (thrown !== null && typeof thrown === 'object' && typeof (thrown as any).then === 'function') {
                const suspensePromise = Promise.resolve(thrown as Promise<unknown>).then(
                    () => { unsuspend.cache.set(cacheKey, { status: 'suspense-resolved' }); },
                    () => { unsuspend.cache.set(cacheKey, { status: 'suspense-resolved' }); },
                );
                unsuspend.cache.set(cacheKey, { status: 'pending', promise: suspensePromise });
                unsuspend.hasPending = true;
                return undefined;
            }
            throw thrown;
        }

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
        unsuspend.hasPending = true;
        return undefined;
    }
    if (existing.status === 'pending') {
        unsuspend.hasPending = true;
        return undefined;
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
