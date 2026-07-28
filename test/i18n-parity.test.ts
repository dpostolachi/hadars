/**
 * i18n unit tests — translation parity checking.
 *
 * checkLocaleParity is the piece meant to run in CI/build tooling: it diffs
 * every locale's keys, per namespace, against a base locale, so a missing
 * key (which only shows up at runtime as a silent raw-key fallback) gets
 * caught before it ships.
 *
 * Run with: bun test test/i18n-parity.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { checkLocaleParity, formatParityIssues, type LocaleMessageTree } from '../src/i18n';

describe('checkLocaleParity', () => {
    test('no issues when every locale has the same keys', () => {
        const tree: LocaleMessageTree = {
            en: { common: { hello: 'Hello', bye: 'Bye' } },
            ro: { common: { hello: 'Salut', bye: 'Pa' } },
        };
        expect(checkLocaleParity(tree, 'en')).toEqual([]);
    });

    test('reports a key missing from a non-base locale', () => {
        const tree: LocaleMessageTree = {
            en: { common: { hello: 'Hello', bye: 'Bye' } },
            ro: { common: { hello: 'Salut' } }, // 'bye' missing
        };
        const issues = checkLocaleParity(tree, 'en');
        expect(issues).toEqual([
            { locale: 'ro', namespace: 'common', missingKeys: ['bye'], extraKeys: [] },
        ]);
    });

    test('reports a key present in a locale but not in the base', () => {
        const tree: LocaleMessageTree = {
            en: { common: { hello: 'Hello' } },
            ro: { common: { hello: 'Salut', extra: 'Something extra' } },
        };
        const issues = checkLocaleParity(tree, 'en');
        expect(issues).toEqual([
            { locale: 'ro', namespace: 'common', missingKeys: [], extraKeys: ['extra'] },
        ]);
    });

    test('checks every namespace independently, including ones missing entirely from a locale', () => {
        const tree: LocaleMessageTree = {
            en: { common: { hello: 'Hello' }, home: { title: 'Welcome' } },
            ro: { common: { hello: 'Salut' } }, // 'home' namespace missing entirely
        };
        const issues = checkLocaleParity(tree, 'en');
        expect(issues).toEqual([
            { locale: 'ro', namespace: 'home', missingKeys: ['title'], extraKeys: [] },
        ]);
    });

    test('the base locale is never checked against itself', () => {
        const tree: LocaleMessageTree = { en: { common: { hello: 'Hello' } } };
        expect(checkLocaleParity(tree, 'en')).toEqual([]);
    });

    test('a namespace that only exists in a non-base locale is still checked (all keys reported as extra)', () => {
        const tree: LocaleMessageTree = {
            en: { common: { hello: 'Hello' } },
            ro: { common: { hello: 'Salut' }, blog: { title: 'Un articol' } },
        };
        const issues = checkLocaleParity(tree, 'en');
        expect(issues).toEqual([
            { locale: 'ro', namespace: 'blog', missingKeys: [], extraKeys: ['title'] },
        ]);
    });

    test('multiple locales are each reported independently', () => {
        const tree: LocaleMessageTree = {
            en: { common: { hello: 'Hello', bye: 'Bye' } },
            ro: { common: { hello: 'Salut' } },
            ru: { common: { hello: 'Privet', bye: 'Poka', extra: 'x' } },
        };
        const issues = checkLocaleParity(tree, 'en');
        expect(issues).toEqual([
            { locale: 'ro', namespace: 'common', missingKeys: ['bye'], extraKeys: [] },
            { locale: 'ru', namespace: 'common', missingKeys: [], extraKeys: ['extra'] },
        ]);
    });
});

describe('formatParityIssues', () => {
    test('renders a readable report grouped by locale/namespace', () => {
        const output = formatParityIssues([
            { locale: 'ro', namespace: 'common', missingKeys: ['bye'], extraKeys: ['legacyKey'] },
        ]);
        expect(output).toContain('ro/common.json');
        expect(output).toContain('missing: bye');
        expect(output).toContain('extra:   legacyKey');
    });

    test('an empty issue list produces an empty string', () => {
        expect(formatParityIssues([])).toBe('');
    });
});
