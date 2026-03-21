import React from 'react';
import type { AppHead, AppUnsuspend, LinkProps, MetaProps, ScriptProps, StyleProps } from '../types/hadars'

interface InnerContext {
    setTitle: (title: string) => void;
    addMeta: (props: MetaProps) => void;
    addLink: (props: LinkProps) => void;
    addStyle: (props: StyleProps) => void;
    addScript: (props: ScriptProps) => void;
    setStatus: (status: number) => void;
}

// Derive a stable dedup key from an element's natural identifying attributes.
function deriveKey(tag: string, props: Record<string, any>): string {
    switch (tag) {
        case 'meta': {
            if (props.name) return `meta:name:${props.name}`;
            if (props.property) return `meta:property:${props.property}`;
            const httpEquiv = props.httpEquiv ?? props['http-equiv'];
            if (httpEquiv) return `meta:http-equiv:${httpEquiv}`;
            if ('charSet' in props || 'charset' in props) return 'meta:charset';
            return `meta:${JSON.stringify(props)}`;
        }
        case 'link': {
            const rel = props.rel ?? '';
            const href = props.href ?? '';
            const as_ = props.as ? `:as:${props.as}` : '';
            return href ? `link:${rel}:${href}${as_}` : `link:${rel}${as_}`;
        }
        case 'script': {
            if (props.src) return `script:src:${props.src}`;
            if (props['data-id']) return `script:id:${props['data-id']}`;
            return `script:${JSON.stringify(props)}`;
        }
        case 'style': {
            if (props['data-id']) return `style:id:${props['data-id']}`;
            return `style:${JSON.stringify(props)}`;
        }
        default:
            return `${tag}:${JSON.stringify(props)}`;
    }
}

// ── Head context resolution ──────────────────────────────────────────────────
//
// On the server, HadarsHead reads from globalThis.__hadarsContext.head which
// the SSR render worker populates before every renderToString call.
// On the client, HadarsHead directly manipulates the DOM.
// This approach means users do NOT need to wrap their App with HadarsContext.

const LINK_ATTR: Record<string, string> = {
    crossOrigin: 'crossorigin',
    referrerPolicy: 'referrerpolicy',
    fetchPriority: 'fetchpriority',
    hrefLang: 'hreflang',
};

function makeServerCtx(head: AppHead): InnerContext {
    return {
        setTitle:  (t) => { head.title = t; },
        addMeta:   (p) => { head.meta[deriveKey('meta', p as any)]     = p; },
        addLink:   (p) => { head.link[deriveKey('link', p as any)]     = p; },
        addStyle:  (p) => { head.style[deriveKey('style', p as any)]   = p; },
        addScript: (p) => { head.script[deriveKey('script', p as any)] = p; },
        setStatus: (s) => { head.status = s; },
    };
}

// Lazy singleton for the client-side DOM context.
let _cliCtx: InnerContext | null = null;

function makeClientCtx(): InnerContext {
    if (_cliCtx) return _cliCtx;
    _cliCtx = {
        setTitle: (title) => { document.title = title; },
        setStatus: () => { /* no-op on client */ },
        addMeta: (props) => {
            const p = props as Record<string, any>;
            let meta: HTMLMetaElement | null = null;
            if (p.name) meta = document.querySelector(`meta[name="${CSS.escape(p.name)}"]`);
            else if (p.property) meta = document.querySelector(`meta[property="${CSS.escape(p.property)}"]`);
            else if (p.httpEquiv ?? p['http-equiv']) meta = document.querySelector(`meta[http-equiv="${CSS.escape(p.httpEquiv ?? p['http-equiv'])}"]`);
            else if ('charSet' in p || 'charset' in p) meta = document.querySelector('meta[charset]');
            if (!meta) { meta = document.createElement('meta'); document.head.appendChild(meta); }
            for (const [k, v] of Object.entries(p)) {
                if (v != null && v !== false) meta.setAttribute(k === 'charSet' ? 'charset' : k === 'httpEquiv' ? 'http-equiv' : k, String(v));
            }
        },
        addLink: (props) => {
            const p = props as Record<string, any>;
            let link: HTMLLinkElement | null = null;
            const asSel = p.as ? `[as="${CSS.escape(p.as)}"]` : '';
            if (p.rel && p.href) link = document.querySelector(`link[rel="${CSS.escape(p.rel)}"][href="${CSS.escape(p.href)}"]${asSel}`);
            else if (p.rel) link = document.querySelector(`link[rel="${CSS.escape(p.rel)}"]${asSel}`);
            if (!link) { link = document.createElement('link'); document.head.appendChild(link); }
            for (const [k, v] of Object.entries(p)) {
                if (v != null && v !== false) link.setAttribute(LINK_ATTR[k] ?? k, String(v));
            }
        },
        addStyle: (props) => {
            const p = props as Record<string, any>;
            let style: HTMLStyleElement | null = null;
            if (p['data-id']) style = document.querySelector(`style[data-id="${CSS.escape(p['data-id'])}"]`);
            if (!style) { style = document.createElement('style'); document.head.appendChild(style); }
            for (const [k, v] of Object.entries(p)) {
                if (k === 'dangerouslySetInnerHTML') { style.innerHTML = (v as any).__html ?? ''; continue; }
                if (v != null && v !== false) style.setAttribute(k, String(v));
            }
        },
        addScript: (props) => {
            const p = props as Record<string, any>;
            let script: HTMLScriptElement | null = null;
            if (p.src) script = document.querySelector(`script[src="${CSS.escape(p.src)}"]`);
            else if (p['data-id']) script = document.querySelector(`script[data-id="${CSS.escape(p['data-id'])}"]`);
            if (!script) { script = document.createElement('script'); document.body.appendChild(script); }
            for (const [k, v] of Object.entries(p)) {
                if (k === 'dangerouslySetInnerHTML') { script.innerHTML = (v as any).__html ?? ''; continue; }
                if (v != null && v !== false) script.setAttribute(k, String(v));
            }
        },
    };
    return _cliCtx;
}

function getCtx(): InnerContext | null {
    if (typeof window === 'undefined') {
        const head: AppHead | undefined = (globalThis as any).__hadarsContext?.head;
        if (!head) return null;
        return makeServerCtx(head);
    }
    return makeClientCtx();
}

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

    // ── unstable-key detection ───────────────────────────────────────────────
    // slim-react retries at component level (not full-tree), so cross-component
    // pass-set tracking produces false positives for valid `async () => value`
    // patterns.  Instead we count how many distinct pending entries have been
    // created this request.  For N legitimate async components that is exactly N.
    // An unstable key (e.g. Date.now() in the key) creates a new pending entry
    // on every retry cycle, growing without bound — we catch that at 100.
    const _u = unsuspend as any;
    if (!_u.pendingCreated) _u.pendingCreated = 0;
    // ────────────────────────────────────────────────────────────────────────

    const existing = unsuspend.cache.get(cacheKey);

    if (!existing) {
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
        _u.pendingCreated++;
        if (_u.pendingCreated > 100) {
            throw new Error(
                `[hadars] useServerData: more than 100 async keys created in a single render. ` +
                `This usually means a key is not stable between renders (e.g. it contains ` +
                `Date.now() or Math.random()). Currently offending key: ${JSON.stringify(cacheKey)}.`,
            );
        }
        const promise = (result as Promise<T>).then(
            value => { unsuspend.cache.set(cacheKey, { status: 'fulfilled', value }); },
            reason => { unsuspend.cache.set(cacheKey, { status: 'rejected', reason }); },
        );
        unsuspend.cache.set(cacheKey, { status: 'pending', promise });
        throw promise; // slim-react will await and retry
    }
    if (existing.status === 'pending') {
        throw existing.promise; // slim-react will await and retry
    }
    if (existing.status === 'rejected') throw existing.reason;
    return existing.value as T;
}


export const Head: React.FC<{
    children?: React.ReactNode;
    status?: number;
}> = React.memo( ({ children, status }) => {

    const ctx = getCtx();
    if (!ctx) return null;

    const { setStatus, setTitle, addMeta, addLink, addStyle, addScript } = ctx;

    if ( status ) {
        setStatus(status);
    }

    React.Children.forEach(children, ( child ) => {
        if ( !React.isValidElement(child) ) return;

        const childType = child.type;
        // React 19 types element.props as unknown; cast here since we
        // inspect props dynamically based on the element type below.
        const childProps = child.props as Record<string, any>;

        switch ( childType ) {
            case 'title': {
                setTitle(childProps['children'] as string);
                return;
            }
            case 'meta': {
                addMeta(childProps as MetaProps);
                return;
            }
            case 'link': {
                addLink(childProps as LinkProps);
                return;
            }
            case 'script': {
                if (!childProps['src'] && !childProps['data-id']) {
                    console.warn('[hadars] <Head>: inline <script> is missing a "data-id" prop — deduplication is not guaranteed across re-renders. Add data-id="unique-key" to ensure it.');
                }
                addScript(childProps as ScriptProps);
                return;
            }
            case 'style': {
                if (!childProps['data-id']) {
                    console.warn('[hadars] <Head>: inline <style> is missing a "data-id" prop — deduplication is not guaranteed across re-renders. Add data-id="unique-key" to ensure it.');
                }
                addStyle(childProps as StyleProps);
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
