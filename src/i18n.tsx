import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
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
 * in your project, which `hadars build` now copies into `.hadars/static/` and
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

interface LocaleContextValue {
    locale: string;
    config: HadarsI18nConfig;
    /** True while a `setLocale()` switch is fetching in-flight namespaces. */
    isSwitching: boolean;
    setLocale: (locale: string) => void;
    /** namespace → resolved messages for the *current* locale. */
    messages: Record<string, Record<string, string>>;
    /** @internal called by useTranslations to register itself and seed SSR data. */
    registerNamespace: (namespace: string, ssrData?: Record<string, string>) => void;
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
    const config: HadarsI18nConfig = { locales, defaultLocale };

    const [locale, setLocaleState] = useState(initialLocale);
    const [messages, setMessages] = useState<Record<string, Record<string, string>>>({});
    const [isSwitching, setIsSwitching] = useState(false);

    // Namespaces currently mounted somewhere in the tree, and a locale:namespace
    // → messages cache so a locale visited before (via SSR or a prior switch)
    // never re-fetches over the network.
    const namespacesRef = useRef(new Set<string>());
    const cacheRef = useRef(new Map<string, Record<string, string>>());

    const registerNamespace = useCallback((namespace: string, ssrData?: Record<string, string>) => {
        if (namespacesRef.current.has(namespace)) return;
        namespacesRef.current.add(namespace);
        if (ssrData) {
            cacheRef.current.set(`${locale}:${namespace}`, ssrData);
            setMessages(prev => (prev[namespace] ? prev : { ...prev, [namespace]: ssrData }));
        }
        // Intentionally locale-at-registration-time only — this just seeds the
        // cache with whatever the server resolved for the *current* locale.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const setLocale = useCallback(async (newLocale: string) => {
        if (newLocale === locale || !locales.includes(newLocale)) return;
        setIsSwitching(true);

        try {
            // Fetch every namespace currently on screen for the new locale, in
            // parallel, cache-first. Waiting for Promise.all (not resolving as
            // each one lands) is what prevents some components from flipping to
            // the new locale before others.
            const entries = await Promise.all(
                Array.from(namespacesRef.current).map(async namespace => {
                    const key = `${newLocale}:${namespace}`;
                    const cached = cacheRef.current.get(key);
                    if (cached) return [namespace, cached] as const;
                    const res = await fetch(`${basePath}/${newLocale}/${namespace}.json`);
                    const data = (await res.json()) as Record<string, string>;
                    cacheRef.current.set(key, data);
                    return [namespace, data] as const;
                }),
            );

            // One batched update — every consumer reads `locale` and `messages`
            // from the same context snapshot, so none can render a mix.
            setMessages(prev => ({ ...prev, ...Object.fromEntries(entries) }));
            setLocaleState(newLocale);

            if (typeof window !== 'undefined') {
                const { page } = parseLocaleFromPath(window.location.pathname, config);
                const newPath = localizePath(page, newLocale, config);
                window.history.replaceState(null, '', newPath + window.location.search);
            }
        } finally {
            setIsSwitching(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locale, locales, basePath]);

    return (
        <LocaleContext.Provider value={{ locale, config, isSwitching, setLocale, messages, registerNamespace }}>
            {children}
        </LocaleContext.Provider>
    );
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
        registerNamespace(namespace, ssrData);
        // Registers once per mount — the namespace's own messages then flow
        // through LocaleProvider's `messages` state on every future switch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const t = useCallback(
        (key: string, vars?: Record<string, string | number>) => {
            const ns = messages[namespace] ?? ssrData ?? {};
            let str = ns[key] ?? key;
            if (vars) {
                for (const [k, v] of Object.entries(vars)) {
                    str = str.replaceAll(`{${k}}`, String(v));
                }
            }
            return str;
        },
        [messages, namespace, ssrData],
    );

    return { t, isSwitching };
}
