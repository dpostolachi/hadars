/**
 * i18n unit tests — pure path helpers.
 *
 * parseLocaleFromPath / localizePath are the routing-free core of the i18n
 * module (LocaleProvider and useTranslations build on top of them). They're
 * plain functions, so they're tested directly without any React rendering.
 *
 * Run with: bun test test/i18n.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { parseLocaleFromPath, localizePath, type HadarsI18nConfig } from '../src/i18n';

const config: HadarsI18nConfig = { locales: ['en', 'ro', 'ru'], defaultLocale: 'en' };

describe('parseLocaleFromPath', () => {
    test('default locale is unprefixed', () => {
        expect(parseLocaleFromPath('/about', config)).toEqual({ locale: 'en', page: '/about' });
    });

    test('root path resolves to the default locale', () => {
        expect(parseLocaleFromPath('/', config)).toEqual({ locale: 'en', page: '/' });
    });

    test('non-default locale prefix is stripped', () => {
        expect(parseLocaleFromPath('/ro/about', config)).toEqual({ locale: 'ro', page: '/about' });
    });

    test('non-default locale root prefix resolves to page "/"', () => {
        expect(parseLocaleFromPath('/ro', config)).toEqual({ locale: 'ro', page: '/' });
    });

    test('nested pages under a locale prefix keep the full remaining path', () => {
        expect(parseLocaleFromPath('/ru/blog/hello-world', config)).toEqual({
            locale: 'ru',
            page: '/blog/hello-world',
        });
    });

    test('an unknown first segment is treated as a page, not a locale', () => {
        expect(parseLocaleFromPath('/roadmap', config)).toEqual({ locale: 'en', page: '/roadmap' });
    });

    test('the default locale is never treated as a stripped prefix', () => {
        // '/en/about' is NOT the same as '/about' in this scheme — 'en' here is
        // just a literal page segment since the default locale is unprefixed.
        expect(parseLocaleFromPath('/en/about', config)).toEqual({ locale: 'en', page: '/en/about' });
    });
});

describe('localizePath', () => {
    test('default locale produces an unprefixed path', () => {
        expect(localizePath('/about', 'en', config)).toBe('/about');
    });

    test('non-default locale adds a prefix', () => {
        expect(localizePath('/about', 'ro', config)).toBe('/ro/about');
    });

    test('root page for a non-default locale has no trailing slash', () => {
        expect(localizePath('/', 'ro', config)).toBe('/ro');
    });

    test('root page for the default locale stays "/"', () => {
        expect(localizePath('/', 'en', config)).toBe('/');
    });
});

describe('parseLocaleFromPath / localizePath round-trip', () => {
    test('localizing a parsed path returns the original URL', () => {
        for (const original of ['/about', '/ro/about', '/ru/blog/hello-world', '/', '/ro']) {
            const { locale, page } = parseLocaleFromPath(original, config);
            expect(localizePath(page, locale, config)).toBe(original === '/ro' ? '/ro' : original);
        }
    });
});
