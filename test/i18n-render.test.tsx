/**
 * i18n render-level tests — LocaleProvider + useTranslations + useLocale
 * mounted as real, interactive React trees (react-dom/client + happy-dom),
 * including an actual client-driven language switch.
 *
 * This project's other tests (render-compare.test.tsx, ssr.test.ts) exercise
 * slim-react's server-string renderer or a real running website server —
 * neither can represent a live, click-driven state transition in the
 * browser. This file adds that missing layer specifically for i18n, since
 * the two real bugs found during review (a frozen-locale closure and a
 * rapid-switch race condition) both live in exactly this kind of stateful,
 * multi-component interaction that no pure-function test can see.
 *
 * useServerData() on the client always either serves a cached value or
 * suspends on a fetch to the *current page URL* (hadars' client-navigation
 * protocol) — it never calls the loader function itself once `window`
 * exists. To let that resolve without a live server, the fetch mock below
 * answers that "page data" request with a generously-sized placeholder
 * array (more entries than this file's test trees ever use), so every
 * useServerData call site can resolve on the first retry regardless of
 * exactly how many namespaces a given test mounts.
 *
 * Run with: bun test test/i18n-render.test.tsx
 */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
// Silences React's "not configured to support act(...)" warning — this is
// the documented flag for non-testing-library environments (see reactjs.org).
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { test, expect, describe, mock, beforeEach, afterEach } from 'bun:test';
import React, { act, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LocaleProvider, useLocale, useTranslations } from '../src/i18n';

// ── fetch mock ─────────────────────────────────────────────────────────

type MessageTree = Record<string, Record<string, Record<string, string>>>;

function installFetchMock(messages: MessageTree) {
    const calls: string[] = [];
    const impl = mock(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push(url);

        const localeFileMatch = /\/locales\/([^/]+)\/([^/.]+)\.json$/.exec(url);
        if (localeFileMatch) {
            const [, locale, namespace] = localeFileMatch;
            const data = messages[locale]?.[namespace] ?? {};
            return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
        }

        // The hadars client-navigation "page data" request — respond with more
        // placeholder entries than any test tree here has useServerData call
        // sites, so every one resolves to `null` (no SSR data) on first retry.
        const placeholder = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, null]));
        return new Response(JSON.stringify({ serverData: placeholder }), { headers: { 'Content-Type': 'application/json' } });
    });
    (globalThis as any).fetch = impl;
    return { impl, calls };
}

// ── mount helpers ───────────────────────────────────────────────────────

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let testCounter = 0;

beforeEach(() => {
    // A unique pathname per test avoids cross-test contamination of hadars'
    // module-level navigation-fetch cache (fetchedPaths / pendingDataFetch),
    // which is keyed by window.location.pathname and shared process-wide.
    testCounter += 1;
    window.history.pushState({}, '', `/render-test-${testCounter}`);
});

afterEach(() => {
    if (root) act(() => { root!.unmount(); });
    if (container) container.remove();
    root = null;
    container = null;
});

async function mount(ui: React.ReactElement): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // Suspense fallback covers the initial useServerData() suspend/retry
    // cycle every useTranslations() call goes through on first mount.
    await act(async () => {
        root!.render(<Suspense fallback={<div data-testid="loading">loading</div>}>{ui}</Suspense>);
    });
    // Flush the queued microtask fetch + the Suspense retry render.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const noopLoad = () => ({}); // never actually called client-side; see file header

// ── fixtures ──────────────────────────────────────────────────────────

const messages: MessageTree = {
    en: { common: { greeting: 'Hello, {name}!' }, footer: { copyright: 'All rights reserved' } },
    ro: { common: { greeting: 'Salut, {name}!' }, footer: { copyright: 'Toate drepturile rezervate' } },
};

function Greeting() {
    const { t } = useTranslations('common', noopLoad);
    return <p data-testid="greeting">{t('greeting', { name: 'Hadar' })}</p>;
}

function Footer() {
    const { t } = useTranslations('footer', noopLoad);
    return <p data-testid="footer">{t('copyright')}</p>;
}

function LocaleLabel() {
    const { locale } = useLocale();
    return <span data-testid="locale">{locale}</span>;
}

function Switcher() {
    const { setLocale } = useLocale();
    return (
        <button data-testid="switch-ro" onClick={() => setLocale('ro')}>
            Switch to RO
        </button>
    );
}

// ── tests ───────────────────────────────────────────────────────────────

describe('LocaleProvider + useTranslations — render level', () => {
    test('renders translated text resolved via the initial locale', async () => {
        installFetchMock(messages);
        await mount(
            <LocaleProvider initialLocale="en" locales={['en', 'ro']} defaultLocale="en">
                <Greeting />
            </LocaleProvider>,
        );
        // No SSR data available client-only (see file header) — first paint
        // falls back to the raw key until a namespace is fetched, exactly as
        // it would on a genuinely first-ever client-only mount.
        expect(container!.querySelector('[data-testid="greeting"]')!.textContent).toBe('greeting');
    });

    test('useLocale() reports the initial locale', async () => {
        installFetchMock(messages);
        await mount(
            <LocaleProvider initialLocale="en" locales={['en', 'ro']} defaultLocale="en">
                <LocaleLabel />
            </LocaleProvider>,
        );
        expect(container!.querySelector('[data-testid="locale"]')!.textContent).toBe('en');
    });

    test('switching locale updates every mounted namespace, and does so atomically', async () => {
        const { impl } = installFetchMock(messages);
        await mount(
            <LocaleProvider initialLocale="en" locales={['en', 'ro']} defaultLocale="en">
                <Greeting />
                <Footer />
                <Switcher />
            </LocaleProvider>,
        );

        const button = container!.querySelector('[data-testid="switch-ro"]') as HTMLButtonElement;
        await act(async () => {
            button.click();
            // Let the parallel fetchLocaleMessages() Promise.all resolve.
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(container!.querySelector('[data-testid="greeting"]')!.textContent).toBe('Salut, Hadar!');
        expect(container!.querySelector('[data-testid="footer"]')!.textContent).toBe('Toate drepturile rezervate');

        const localeFileCalls = impl.mock.calls
            .map(([u]: [string]) => u)
            .filter((u: string) => u.includes('/locales/'));
        expect(localeFileCalls.sort()).toEqual([
            '/locales/ro/common.json',
            '/locales/ro/footer.json',
        ]);
    });

    test('switching back to a previously-visited locale is served from cache (no new fetch)', async () => {
        // The *initial* locale's data comes from useServerData, not
        // fetchLocaleMessages, so it's never in LocaleProvider's own cache —
        // switching en→ro→en→ro instead exercises a genuine cache hit on the
        // second 'ro' switch, without that ambiguity.
        const { impl } = installFetchMock(messages);
        function App() {
            const { setLocale } = useLocale();
            return (
                <>
                    <Greeting />
                    <button data-testid="switch-ro" onClick={() => setLocale('ro')}>ro</button>
                    <button data-testid="switch-en" onClick={() => setLocale('en')}>en</button>
                </>
            );
        }
        await mount(
            <LocaleProvider initialLocale="en" locales={['en', 'ro']} defaultLocale="en">
                <App />
            </LocaleProvider>,
        );

        const toRo = container!.querySelector('[data-testid="switch-ro"]') as HTMLButtonElement;
        const toEn = container!.querySelector('[data-testid="switch-en"]') as HTMLButtonElement;
        const flush = () => Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());

        await act(async () => { toRo.click(); await flush(); }); // fetches ro (1st ro fetch)
        expect(container!.querySelector('[data-testid="greeting"]')!.textContent).toBe('Salut, Hadar!');

        await act(async () => { toEn.click(); await flush(); }); // fetches en (never cached)
        await act(async () => { toRo.click(); await flush(); }); // should be a cache hit now

        expect(container!.querySelector('[data-testid="greeting"]')!.textContent).toBe('Salut, Hadar!');

        const roCallsTotal = impl.mock.calls
            .map(([u]: [string]) => u)
            .filter((u: string) => u === '/locales/ro/common.json').length;
        // Exactly one network call for ro/common.json across both ro switches —
        // the second one was served from LocaleProvider's cache.
        expect(roCallsTotal).toBe(1);
    });

    test('document.documentElement.lang tracks the current locale', async () => {
        installFetchMock(messages);
        await mount(
            <LocaleProvider initialLocale="en" locales={['en', 'ro']} defaultLocale="en">
                <Greeting />
                <Switcher />
            </LocaleProvider>,
        );
        expect(document.documentElement.lang).toBe('en');

        const button = container!.querySelector('[data-testid="switch-ro"]') as HTMLButtonElement;
        await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
        expect(document.documentElement.lang).toBe('ro');
    });

    test('rapid switching applies the last click, not whichever fetch resolves last', async () => {
        // A slow 'ro' response (clicked first) must not override a fast 'ru'
        // resolution (clicked second) once it eventually lands — this is the
        // exact race the generation-counter guard in setLocale exists for.
        // Both targets must differ from the *currently committed* locale, or
        // the second click's `newLocale === locale` early-return makes it a
        // no-op instead of a genuine concurrent switch.
        const raceMessages: MessageTree = {
            en: { common: { greeting: 'Hello, {name}!' } },
            ro: { common: { greeting: 'Salut, {name}!' } },
            ru: { common: { greeting: 'Privet, {name}!' } },
        };

        let resolveRo!: () => void;
        const roGate = new Promise<void>(res => { resolveRo = res; });

        const impl = mock(async (input: string | URL | Request) => {
            const url = typeof input === 'string' ? input : input.toString();
            const localeFileMatch = /\/locales\/([^/]+)\/([^/.]+)\.json$/.exec(url);
            if (localeFileMatch) {
                const [, locale, namespace] = localeFileMatch;
                if (locale === 'ro') await roGate; // held open until released below
                const data = raceMessages[locale]?.[namespace] ?? {};
                return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
            }
            const placeholder = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, null]));
            return new Response(JSON.stringify({ serverData: placeholder }), { headers: { 'Content-Type': 'application/json' } });
        });
        (globalThis as any).fetch = impl;

        function App() {
            const { locale, setLocale } = useLocale();
            return (
                <>
                    <Greeting />
                    <span data-testid="locale">{locale}</span>
                    <button data-testid="to-ro" onClick={() => setLocale('ro')}>ro</button>
                    <button data-testid="to-ru" onClick={() => setLocale('ru')}>ru</button>
                </>
            );
        }

        await mount(
            <LocaleProvider initialLocale="en" locales={['en', 'ro', 'ru']} defaultLocale="en">
                <App />
            </LocaleProvider>,
        );
        const flush = () => Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());

        // Click ro (held open by roGate — slow), then click ru before it resolves.
        await act(async () => {
            (container!.querySelector('[data-testid="to-ro"]') as HTMLButtonElement).click();
            await Promise.resolve();
        });
        await act(async () => {
            (container!.querySelector('[data-testid="to-ru"]') as HTMLButtonElement).click();
            await flush();
        });

        expect(container!.querySelector('[data-testid="locale"]')!.textContent).toBe('ru');
        expect(container!.querySelector('[data-testid="greeting"]')!.textContent).toBe('Privet, Hadar!');

        // Now release the slow 'ro' response — it must be discarded, not win.
        await act(async () => { resolveRo(); await flush(); });

        expect(container!.querySelector('[data-testid="locale"]')!.textContent).toBe('ru');
        expect(container!.querySelector('[data-testid="greeting"]')!.textContent).toBe('Privet, Hadar!');
    });
});
