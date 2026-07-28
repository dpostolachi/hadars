#!/usr/bin/env bun
/**
 * Checks that every locale under static/locales/ has exactly the same set of
 * translation keys, per namespace, as the base locale — run this in CI (or
 * as a pre-commit hook) to catch a missing/extra key before it ships as a
 * silent raw-key fallback at runtime.
 *
 * Usage: bun scripts/check-i18n-parity.ts [--base=en] [--dir=static/locales]
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkLocaleParity, formatParityIssues, type LocaleMessageTree } from 'hadars';

const args = Object.fromEntries(
    process.argv.slice(2).map(arg => {
        const [key, value] = arg.replace(/^--/, '').split('=');
        return [key, value ?? true];
    }),
);

const baseLocale = typeof args.base === 'string' ? args.base : 'en';
const localesDir = typeof args.dir === 'string' ? args.dir : 'static/locales';

async function loadTree(dir: string): Promise<LocaleMessageTree> {
    const tree: LocaleMessageTree = {};
    const locales = await readdir(dir, { withFileTypes: true });

    for (const localeEntry of locales) {
        if (!localeEntry.isDirectory()) continue;
        const locale = localeEntry.name;
        tree[locale] = {};

        const files = await readdir(join(dir, locale), { withFileTypes: true });
        for (const fileEntry of files) {
            if (!fileEntry.isFile() || !fileEntry.name.endsWith('.json')) continue;
            const namespace = fileEntry.name.replace(/\.json$/, '');
            const raw = await readFile(join(dir, locale, fileEntry.name), 'utf-8');
            tree[locale][namespace] = JSON.parse(raw);
        }
    }

    return tree;
}

const tree = await loadTree(localesDir);

if (!tree[baseLocale]) {
    console.error(`[i18n-parity] base locale "${baseLocale}" not found under ${localesDir}/`);
    process.exit(1);
}

const issues = checkLocaleParity(tree, baseLocale);

if (issues.length === 0) {
    console.log(`[i18n-parity] OK — ${Object.keys(tree).length} locale(s) match "${baseLocale}" exactly.`);
    process.exit(0);
}

console.error(`[i18n-parity] ${issues.length} mismatch(es) found against base locale "${baseLocale}":\n`);
console.error(formatParityIssues(issues));
process.exit(1);
