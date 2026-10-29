import { test, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import loader from '../src/utils/loader';
import { MODULE_KEY_PREFIX, lazy, preloadModules } from '../src/utils/lazyModules';

const SOURCE = `const A = lazy(() => loadModule<X>('./pages/A'));\nconst B = loadModule("src/B");\n`;
const run = (server: boolean) =>
    loader.call({ getOptions: () => ({ server }), resourcePath: `${process.cwd()}/src/App.tsx`, emitWarning() {} }, SOURCE);

test('loader: server build requires the module and names it by project-relative id', () => {
    const out = run(true);
    expect(out).toContain(`globalThis.__hadarsLoadModule("src/pages/A", () => Promise.resolve(require('./pages/A')))`);
    expect(out).toContain(`globalThis.__hadarsLoadModule("src/B", () => Promise.resolve(require("src/B")))`);
    expect(out).not.toContain('__hadarsRegisterModule');
});

test('loader: browser build imports lazily and registers every chunk at module scope', () => {
    const out = run(false);
    expect(out).toContain(`globalThis.__hadarsLoadModule("src/pages/A", () => import('./pages/A'))`);
    expect(out).toContain(`globalThis.__hadarsRegisterModule?.("src/pages/A", () => import('./pages/A'));`);
    expect(out).toContain(`globalThis.__hadarsRegisterModule?.("src/B", () => import("src/B"));`);
});

const g = globalThis as any;
const Page = ({ n }: { n: number }) => React.createElement('p', null, `page ${n}`);

test('server render records the chunks it loaded for the client to preload', async () => {
    const cache = new Map<string, unknown>();
    g.__hadarsUnsuspend = { cache };
    try {
        void g.__hadarsLoadModule('test/recorded', () => Promise.resolve({ default: Page }));
    } finally {
        g.__hadarsUnsuspend = null;
    }
    expect(cache.get(MODULE_KEY_PREFIX + 'test/recorded')).toEqual({ status: 'fulfilled', value: true });
});

test('preloaded lazy() renders synchronously, so hydration never suspends', async () => {
    g.__hadarsRegisterModule('test/preloaded', () => Promise.resolve({ default: Page }));
    const Lazy = lazy<{ default: typeof Page }, { n: number }>(() => g.__hadarsLoadModule('test/preloaded', () => Promise.resolve({ default: Page })));
    await preloadModules(['test/preloaded']);
    expect(renderToString(React.createElement(Lazy, { n: 1 }))).toContain('page 1');
});

test('lazy() picks a named export', async () => {
    const mod = { Tab: Page };
    const Lazy = lazy(() => g.__hadarsLoadModule('test/named', () => Promise.resolve(mod)), (m: typeof mod) => m.Tab);
    await g.__hadarsLoadModule('test/named', () => Promise.resolve(mod));
    expect(renderToString(React.createElement(Lazy, { n: 2 }))).toContain('page 2');
});
