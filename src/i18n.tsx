import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { useServerData } from './utils/Head';

/**
 * i18n for hadars apps.
 *
 * hadars has no built-in router, so this module deliberately doesn't assume
 * one either — locale lives in the URL path (default locale unprefixed,
 * others prefixed: `/about` = default, `/ro/about` = Romanian) and is read
 * directly from `req.pathname` / `window.location.pathname`.
 *
 * Message files are treated as static assets (e.g. `static/locales/en/common.json`
 * in your project, which `hadars build` copies into `.hadars/static/` and
 * therefore into both `run()` serving and `hadars export static` output) — not
 * as `useServerData` payloads on navigation, since translations don't need a
 * live server to be resolved per-request.
 *
 * `useTranslations` still uses `useServerData` once, for the *initial* SSR
 * render only, so first paint has zero waterfall and works identically in
 * live-server and static-export deployments. Locale switches after that are
 * plain client-side `fetch()` calls against those same static files, batched
 * and applied atomically via `LocaleProvider` so no component can render with
 * a locale/messages mismatch mid-switch.
 */

export interface HadarsI18nConfig {
    /** All supported locale codes, e.g. `['en', 'ro', 'ru']`. */
    locales: string[];
    /** The locale served unprefixed at the root, e.g. `'en'`. */
    defaultLocale: string;
}

export interface ParsedLocalePath {
    locale: string;
    /** The path with any locale prefix stripped, e.g. `/about`. */
    page: string;
}

/**
 * Extracts the locale from a URL path. Only strips a prefix that exactly
 * matches a configured non-default locale — `/ro/about` → `{ locale: 'ro',
 * page: '/about' }` — anything else (including the bare default locale) is
 * left untouched: `/about` → `{ locale: defaultLocale, page: '/about' }`.
 */
export function parseLocaleFromPath(pathname: string, config: HadarsI18nConfig): ParsedLocalePath {
    const { locales, defaultLocale } = config;
    const segments = pathname.split('/');
    const first = segments[1];

    if (first && locales.includes(first) && first !== defaultLocale) {
        const page = '/' + segments.slice(2).join('/');
        return { locale: first, page: page === '/' ? '/' : page.replace(/\/$/, '') || '/' };
    }

    return { locale: defaultLocale, page: pathname || '/' };
}

/**
 * Builds the URL for `page` in `locale` — the inverse of `parseLocaleFromPath`.
 * The default locale is never prefixed.
 */
export function localizePath(page: string, locale: string, config: HadarsI18nConfig): string {
    if (locale === config.defaultLocale) return page;
    return `/${locale}${page === '/' ? '' : page}`;
}

/**
 * Resolves a set of namespaces for `newLocale`, cache-first, all in parallel.
 *
 * Pulled out of `LocaleProvider` as a plain function (no React) specifically
 * so it's unit-testable without mounting a component tree — pass a fake
 * `fetchImpl` to exercise cache hits/misses and batching directly.
 */
export async function fetchLocaleMessages(
    newLocale: string,
    namespaces: Iterable<string>,
    basePath: string,
    cache: Map<string, Record<string, string>>,
    fetchImpl: typeof fetch = fetch,
): Promise<Record<string, Record<string, string>>> {
    const entries = await Promise.all(
        Array.from(namespaces).map(async namespace => {
            const key = `${newLocale}:${namespace}`;
            const cached = cache.get(key);
            if (cached) return [namespace, cached] as const;
            const res = await fetchImpl(`${basePath}/${newLocale}/${namespace}.json`);
            const data = (await res.json()) as Record<string, string>;
            cache.set(key, data);
            return [namespace, data] as const;
        }),
    );
    return Object.fromEntries(entries);
}

interface LocaleContextValue {
    locale: string;
    config: HadarsI18nConfig;
    /** True while a `setLocale()` switch is fetching in-flight namespaces. */
    isSwitching: boolean;
    setLocale: (locale: string) => void;
    /** namespace → resolved messages for the *current* locale. */
    messages: Record<string, Record<string, string>>;
    /** @internal called by useTranslations to register itself and seed SSR data. */
    registerNamespace: (namespace: string, forLocale: string, ssrData?: Record<string, string>) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export interface LocaleProviderProps extends HadarsI18nConfig {
    /** Locale resolved server-side, e.g. via `parseLocaleFromPath(req.pathname, config)`. */
    initialLocale: string;
    /** Where translation JSON lives, relative to the site root. Default: `/static/locales`. */
    basePath?: string;
    children: ReactNode;
}

export const LocaleProvider: React.FC<LocaleProviderProps> = ({
    initialLocale,
    locales,
    defaultLocale,
    basePath = '/static/locales',
    children,
}) => {
    // Keyed off a stable string so passing a fresh `locales={[...]}` array
    // literal on every render doesn't defeat the memo below.
    const localesKey = locales.join(',');
    const config = useMemo<HadarsI18nConfig>(
        () => ({ locales, defaultLocale }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [localesKey, defaultLocale],
    );

    const [locale, setLocaleState] = useState(initialLocale);
    const [messages, setMessages] = useState<Record<string, Record<string, string>>>({});
    const [isSwitching, setIsSwitching] = useState(false);

    // Namespaces currently mounted somewhere in the tree, and a locale:namespace
    // → messages cache so a locale visited before (via SSR or a prior switch)
    // never re-fetches over the network.
    const namespacesRef = useRef(new Set<string>());
    const cacheRef = useRef(new Map<string, Record<string, string>>());

    // Guards against a slow switch resolving *after* a newer one, which would
    // otherwise silently override the user's latest choice (last-to-resolve
    // would win instead of last-to-be-clicked).
    const switchGenerationRef = useRef(0);

    // No closure over `locale` here — the caller (useTranslations) passes the
    // locale its SSR data was actually resolved for, so this stays correct
    // even if a namespace registers long after the locale has changed.
    const registerNamespace = useCallback((namespace: string, forLocale: string, ssrData?: Record<string, string>) => {
        if (namespacesRef.current.has(namespace)) return;
        namespacesRef.current.add(namespace);
        if (ssrData) {
            cacheRef.current.set(`${forLocale}:${namespace}`, ssrData);
            setMessages(prev => (prev[namespace] ? prev : { ...prev, [namespace]: ssrData }));
        }
    }, []);

    const setLocale = useCallback(async (newLocale: string) => {
        if (newLocale === locale || !locales.includes(newLocale)) return;

        const myGeneration = ++switchGenerationRef.current;
        setIsSwitching(true);

        try {
            // Every namespace currently on screen, fetched for the new locale
            // in parallel, cache-first. Waiting for the whole batch (rather
            // than applying each namespace as it lands) is what prevents some
            // components from flipping to the new locale before others.
            const resolved = await fetchLocaleMessages(newLocale, namespacesRef.current, basePath, cacheRef.current);

            // A newer switch started while this one was in flight — discard
            // this (now-stale) result instead of overriding the later choice.
            if (myGeneration !== switchGenerationRef.current) return;

            setMessages(prev => ({ ...prev, ...resolved }));
            setLocaleState(newLocale);

            if (typeof window !== 'undefined') {
                const { page } = parseLocaleFromPath(window.location.pathname, config);
                const newPath = localizePath(page, newLocale, config);
                window.history.replaceState(null, '', newPath + window.location.search);
            }
        } finally {
            if (myGeneration === switchGenerationRef.current) setIsSwitching(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locale, locales, basePath, config]);

    // Keeps the document's declared language in sync on both the initial
    // render and every subsequent switch — a single source of truth rather
    // than setting it inline inside setLocale.
    useEffect(() => {
        if (typeof document !== 'undefined') document.documentElement.lang = locale;
    }, [locale]);

    const value = useMemo<LocaleContextValue>(
        () => ({ locale, config, isSwitching, setLocale, messages, registerNamespace }),
        [locale, config, isSwitching, setLocale, messages, registerNamespace],
    );

    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export function useLocale(): LocaleContextValue {
    const ctx = useContext(LocaleContext);
    if (!ctx) throw new Error('[hadars] useLocale() must be used within a <LocaleProvider>.');
    return ctx;
}

/** Builds a link to `path` in the current locale — use for internal navigation. */
export function useLocalizedPath(path: string): string {
    const { locale, config } = useLocale();
    return localizePath(path, locale, config);
}

export interface UseTranslationsResult {
    /** `t('key')` or `t('key', { name: 'Hadar' })` for `{name}`-style interpolation. */
    t: (key: string, vars?: Record<string, string | number>) => string;
    /** True while a locale switch is fetching this namespace for the first time. */
    isSwitching: boolean;
}

/**
 * Loads a translation namespace for the current locale.
 *
 * `loadMessages` is **server-only** — like any `useServerData` closure, it's
 * stripped from the client bundle and only ever runs during SSR, to resolve
 * the initial render with zero client waterfall. All subsequent locale
 * switches are handled by `LocaleProvider` via plain `fetch()` against your
 * static message files, not by re-invoking this function.
 *
 * @example
 * const { t } = useTranslations('home', (locale, ns) =>
 *   import(`../../static/locales/${locale}/${ns}.json`).then(m => m.default)
 * );
 * return <h1>{t('hero.title', { name: 'Hadar' })}</h1>;
 */
export function useTranslations(
    namespace: string,
    loadMessages: (locale: string, namespace: string) => Promise<Record<string, string>> | Record<string, string>,
): UseTranslationsResult {
    const { locale, messages, registerNamespace, isSwitching } = useLocale();
    const ssrData = useServerData(() => loadMessages(locale, namespace)) as Record<string, string> | undefined;

    useEffect(() => {
        // Registers once per mount, tagged with the locale this data was
        // actually resolved for (the locale at mount time) — not whatever
        // the provider's locale happens to be later.
        registerNamespace(namespace, locale, ssrData);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const namespaceMessages = messages[namespace];

    const t = useCallback(
        (key: string, vars?: Record<string, string | number>) => {
            const ns = namespaceMessages ?? ssrData ?? {};
            let str = ns[key] ?? key;
            if (vars) {
                for (const [k, v] of Object.entries(vars)) {
                    str = str.replaceAll(`{${k}}`, String(v));
                }
            }
            return str;
        },
        [namespaceMessages, ssrData],
    );

    return { t, isSwitching };
}
