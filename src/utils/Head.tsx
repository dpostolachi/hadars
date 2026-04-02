import React from 'react';
import type { AppHead, AppUnsuspend, HadarsDocumentNode, LinkProps, MetaProps, ScriptProps, StyleProps } from '../types/hadars'

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
// hydration. During the initial SSR load, keyed by the server's useId() values
// (which match React's hydrateRoot IDs). During client-side navigation the
// server keys are _R_..._  (slim-react format) but the client is NOT in
// hydration mode so useId() returns _r_..._  — a completely different format.
// We bridge this by storing navigation results as an ordered array and consuming
// them sequentially on the retry, then caching by the client's own useId() key.
const clientServerDataCache = new Map<string, unknown>();

// Tracks in-flight data-only requests keyed by pathname+search so that all
// useServerData calls within a single Suspense pass share one network request.
const pendingDataFetch = new Map<string, Promise<void>>();
// Paths for which a client data fetch has already completed. Prevents re-fetching
// when a key is genuinely absent from the server response for this path.
const fetchedPaths = new Set<string>();

// Ordered values from the most recent navigation fetch.
// React retries suspended components in tree order (same order as SSR), so
// consuming these positionally is safe and avoids the server/client key mismatch.
let _navValues: unknown[] = [];
let _navIdx = 0;

/** Call this before hydrating to seed the client cache from the server's data.
 *  Invoked automatically by the hadars client bootstrap.
 *  Always clears the existing cache before populating — call with `{}` to just clear. */
export function initServerDataCache(data: Record<string, unknown>) {
    clientServerDataCache.clear();
    _navValues = [];
    _navIdx = 0;
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
 * The cache key is derived automatically from the call-site's position in the
 * component tree via `useId()` — no manual key is required.
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
 * const user = useServerData(() => db.getUser(id));
 * const post = useServerData(() => db.getPost(postId));
 * if (!user) return null; // undefined while pending on the first SSR pass
 *
 * // cache: false — evicts the entry on unmount so the next mount fetches fresh data
 * const stats = useServerData(() => getServerStats(), { cache: false });
 */
export function useServerData<T>(fn: () => Promise<T> | T, options?: { cache?: boolean }): T | undefined {
    const cacheKey = React.useId();

    // When cache: false, evict the entry on unmount so the next mount fetches
    // fresh data from the server. The eviction is deferred via setTimeout so
    // that React Strict Mode's synchronous fake-unmount/remount cycle can cancel
    // it before it fires — a real unmount has no follow-up effect to cancel it.
    const evictTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useEffect(() => {
        if (options?.cache !== false) return;
        // Cancel any timer left over from a Strict Mode fake unmount.
        if (evictTimerRef.current !== null) {
            clearTimeout(evictTimerRef.current);
            evictTimerRef.current = null;
        }
        return () => {
            evictTimerRef.current = setTimeout(() => {
                clientServerDataCache.delete(cacheKey);
                evictTimerRef.current = null;
            }, 0);
        };
    }, []);

    if (typeof window !== 'undefined') {
        // Cache hit — return the server-resolved value directly.
        if (clientServerDataCache.has(cacheKey)) {
            return clientServerDataCache.get(cacheKey) as T;
        }

        // Cache miss — this component is mounting during client-side navigation
        // (the server hasn't sent data for this path yet). Fire a data-only
        // request to the server at the current URL and suspend via React Suspense
        // until it completes. All useServerData calls within the same React render
        // share one Promise so only one network request is made per navigation.
        const pathKey = window.location.pathname + window.location.search;

        // After a navigation fetch has completed, consume values positionally.
        // The server returns keys in slim-react (_R_..._) format, but the client
        // is not in hydration mode so useId() returns _r_..._  — they never match.
        // We store the ordered values from the fetch and hand them out in tree
        // order (which is identical on server and client for a given route).
        if (fetchedPaths.has(pathKey)) {
            if (_navIdx < _navValues.length) {
                const value = _navValues[_navIdx++] as T;
                clientServerDataCache.set(cacheKey, value);
                return value;
            }
            // Positional data exhausted — cache:false eviction or remount with new
            // useId() keys. Remove the path so a fresh fetch fires below.
            fetchedPaths.delete(pathKey);
            _navValues = [];
            _navIdx = 0;
            // fall through to trigger a new fetch
        }

        if (!pendingDataFetch.has(pathKey)) {
            let resolve!: () => void;
            const p = new Promise<void>(res => { resolve = res; });
            pendingDataFetch.set(pathKey, p);
            // Fire in a microtask so that every useServerData call in this React
            // render is registered against the same deferred before the fetch starts.
            queueMicrotask(async () => {
                try {
                    let json: { serverData: Record<string, unknown> } | null = null;

                    if ((globalThis as any).__hadarsStatic) {
                        // Static export: the __hadarsStatic flag was embedded in the
                        // page by `hadars export static`. Fetch the pre-generated
                        // index.json sidecar directly — no live SSR server exists.
                        const sidecarUrl = pathKey.replace(/\/$/, '') + '/index.json';
                        const res = await fetch(sidecarUrl).catch(() => null);
                        if (res?.ok) json = await res.json().catch(() => null);
                    } else {
                        // Live server: request the current URL with Accept: application/json.
                        const res = await fetch(pathKey, { headers: { 'Accept': 'application/json' } });
                        if (res.ok) json = await res.json();
                    }

                    // Store as ordered array — consumed positionally on retry to
                    // avoid the server (_R_..._) vs client (_r_..._) key mismatch.
                    _navValues = Object.values(json?.serverData ?? {});
                    _navIdx = 0;
                    // Only keep the freshly-fetched path in fetchedPaths — clear
                    // others so stale positional data from a previous page cannot
                    // be served if the user navigates back to it.
                    fetchedPaths.clear();
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


// ── useGraphQL ────────────────────────────────────────────────────────────────
//
// Execute a GraphQL query during SSR via the hadars data layer. The executor
// is stored in globalThis.__hadarsGraphQL by the framework before each render.
// On the client, useServerData handles hydration + client-side navigation.

/**
 * Execute a GraphQL query server-side and return the result.
 *
 * Wraps `useServerData` — on the client the pre-resolved value is read from
 * the hydration cache. During client-side navigation hadars automatically
 * fires a data-only request to the server so the query re-executes there.
 *
 * Throws if the executor returns GraphQL errors, so the page is correctly
 * marked as failed during `hadars export static`.
 *
 * ```tsx
 * // Typed via codegen document — TData and TVariables are inferred:
 * const result = useGraphQL(GetPostDocument, { slug });
 * const post = result?.data?.blogPost; // fully typed
 *
 * // Plain string query — untyped:
 * const result = useGraphQL(`{ allBlogPost { slug title } }`);
 * if (!result) return null; // undefined while pending on first SSR pass
 * ```
 */
// Overload 1: TypedDocumentNode — TData and TVariables are inferred from the document.
export function useGraphQL<
    TData,
    TVariables extends Record<string, unknown>,
>(
    query: HadarsDocumentNode<TData, TVariables>,
    variables?: TVariables,
): { data?: TData } | undefined;
// Overload 2: plain string query — untyped result.
export function useGraphQL(
    query: string,
    variables?: Record<string, unknown>,
): { data?: Record<string, unknown> } | undefined;
// Implementation
export function useGraphQL(
    query: string | HadarsDocumentNode<unknown, Record<string, unknown>>,
    variables?: Record<string, unknown>,
): { data?: unknown } | undefined {
    return useServerData(async () => {
        const executor: ((q: any, v?: Record<string, unknown>) => Promise<any>) | undefined =
            (globalThis as any).__hadarsGraphQL;

        if (!executor) {
            throw new Error(
                '[hadars] useGraphQL: no GraphQL executor is available for this request. ' +
                'Make sure you have `sources` or a `graphql` executor configured in hadars.config.ts.',
            );
        }

        // Pass the original query (string or document object) — the executor
        // calls print() itself so codegen documents without loc.source.body work.
        const result = await executor(query, variables);

        if (result.errors?.length) {
            const messages = result.errors.map((e: { message: string }) => e.message).join(', ');
            throw new Error(`[hadars] GraphQL error: ${messages}`);
        }

        return result;
    });
}

// ── HadarsHead ────────────────────────────────────────────────────────────────

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
                const raw = childProps['children'];
                setTitle(Array.isArray(raw) ? raw.join('') : String(raw ?? ''));
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
