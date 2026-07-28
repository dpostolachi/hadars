/**
 * i18n unit tests — runtime fetch/cache logic.
 *
 * `fetchLocaleMessages` is the piece of LocaleProvider's `setLocale` that
 * actually resolves namespaces for a new locale (cache-first, batched via
 * Promise.all). It's a plain async function — no React needed — specifically
 * so this behavior can be verified directly with a mocked `fetch`, including
 * the cache-hit path a naive re-render-based test wouldn't easily reach.
 *
 * Run with: bun test test/i18n-runtime.test.ts
 */

import { test, expect, describe, mock } from 'bun:test';
import { fetchLocaleMessages } from '../src/i18n';

function jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

describe('fetchLocaleMessages', () => {
    test('fetches every namespace for the new locale from the given basePath', async () => {
        const calls: string[] = [];
        const fakeFetch = mock(async (url: string) => {
            calls.push(url);
            return jsonResponse({ hello: `hello-${url}` });
        });

        const cache = new Map<string, Record<string, string>>();
        const result = await fetchLocaleMessages('ro', ['common', 'home'], '/static/locales', cache, fakeFetch as any);

        expect(calls.sort()).toEqual([
            '/static/locales/ro/common.json',
            '/static/locales/ro/home.json',
        ]);
        expect(Object.keys(result).sort()).toEqual(['common', 'home']);
    });

    test('requests all namespaces in parallel, not sequentially', async () => {
        const started: string[] = [];
        const fakeFetch = mock(async (url: string) => {
            started.push(url);
            // Both calls must have started before either resolves — proves
            // Promise.all (parallel), not a sequential await-in-a-loop.
            await new Promise(r => setTimeout(r, 5));
            return jsonResponse({});
        });

        const cache = new Map<string, Record<string, string>>();
        await fetchLocaleMessages('ro', ['a', 'b', 'c'], '/static/locales', cache, fakeFetch as any);

        expect(started).toHaveLength(3);
    });

    test('a cached namespace is served without a network call', async () => {
        const fakeFetch = mock(async () => jsonResponse({ hello: 'network' }));
        const cache = new Map<string, Record<string, string>>();
        cache.set('ro:common', { hello: 'cached' });

        const result = await fetchLocaleMessages('ro', ['common'], '/static/locales', cache, fakeFetch as any);

        expect(fakeFetch).not.toHaveBeenCalled();
        expect(result.common).toEqual({ hello: 'cached' });
    });

    test('mixed cache hit + miss only fetches the missing namespace', async () => {
        const calls: string[] = [];
        const fakeFetch = mock(async (url: string) => {
            calls.push(url);
            return jsonResponse({ hello: 'fetched' });
        });

        const cache = new Map<string, Record<string, string>>();
        cache.set('ro:common', { hello: 'cached' });

        const result = await fetchLocaleMessages('ro', ['common', 'home'], '/static/locales', cache, fakeFetch as any);

        expect(calls).toEqual(['/static/locales/ro/home.json']);
        expect(result.common).toEqual({ hello: 'cached' });
        expect(result.home).toEqual({ hello: 'fetched' });
    });

    test('a freshly fetched namespace is written into the shared cache for next time', async () => {
        const fakeFetch = mock(async () => jsonResponse({ hello: 'fresh' }));
        const cache = new Map<string, Record<string, string>>();

        await fetchLocaleMessages('ru', ['common'], '/static/locales', cache, fakeFetch as any);

        expect(cache.get('ru:common')).toEqual({ hello: 'fresh' });
    });

    test('different locales for the same namespace get independent cache entries', async () => {
        const fakeFetch = mock(async (url: string) => jsonResponse({ url }));
        const cache = new Map<string, Record<string, string>>();

        await fetchLocaleMessages('en', ['common'], '/static/locales', cache, fakeFetch as any);
        await fetchLocaleMessages('ro', ['common'], '/static/locales', cache, fakeFetch as any);

        expect(cache.has('en:common')).toBe(true);
        expect(cache.has('ro:common')).toBe(true);
        expect(cache.get('en:common')).not.toEqual(cache.get('ro:common'));
    });

    test('no namespaces means no fetches and an empty result', async () => {
        const fakeFetch = mock(async () => jsonResponse({}));
        const cache = new Map<string, Record<string, string>>();

        const result = await fetchLocaleMessages('ro', [], '/static/locales', cache, fakeFetch as any);

        expect(fakeFetch).not.toHaveBeenCalled();
        expect(result).toEqual({});
    });
});
