import { expect, test } from 'bun:test';
import { hasUnsupportedServerLoading, linkServer } from '../src/composition/linkServer';

const accepted = [
    'module.exports = "Articles require context and import( examples";',
    'module.exports = `Articles require context and import( examples ${1}`;',
    '// require("x") import("x")\n/* require import( */ module.exports = 1;',
    'module.exports = /require|import\\(/;',
    'module.exports = [{ require: 1 }, { "require": 2 }, { ["require"]: 3, import: "import(" }];',
    'function requireAuth() { return "require import("; } module.exports = requireAuth();',
    'module.exports = JSON.parse(\'{"require":"import(","text":"require"}\');',
    'module.exports = function(require) { return require("x"); };',
    'module.exports = function() { return require; function require() {} };',
    'const { require } = { require: 1 }; module.exports = require;',
    'const { value: require = 1 } = {}; module.exports = require;',
    'module.exports = class require { method() { return require; } };',
    'try { throw 1; } catch (require) { module.exports = require; }',
    'module.exports = { set value(require) { globalThis.value = require; } };',
    'require: for (;;) { break require; } module.exports = 1;',
    'module.exports = ({ require = 1 }) => require;',
    'module.exports = function([require]) { return { require }; };',
];

const rejected = [
    'module.exports = require("x");',
    'const r = require; module.exports = r;',
    'module.exports = typeof require;',
    'module.exports = module.require;',
    'module.exports = globalThis.require;',
    'module.exports = globalThis["require"];',
    'module.exports = globalThis["requ\\u0069re"];',
    'module.exports = globalThis?.require;',
    'module.exports = import("x");',
    'module.exports = import(variable);',
    'module.exports = import.meta;',
    'module.exports = `${require}`;',
    'module.exports = { require };',
    'module.exports = { [require]: 1 };',
    'module.exports = function(require) { return require; }; globalThis.loader = require;',
    'module.exports = function({ value = require }) { return value; };',
];

for (const source of accepted) {
    test(`syntax inspection accepts ${source}`, () => {
        expect(hasUnsupportedServerLoading(source)).toBe(false);
    });
    test(`server linking accepts ${source}`, async () => {
        const linked = await linkServer('example', 'server/main.cjs', new Map([['server/main.cjs', Buffer.from(source)]]));
        expect(linked.files).toEqual(['server/main.cjs']);
        expect(linked.factory).toContain('return module.exports;');
    });
}

for (const source of rejected) {
    test(`syntax inspection rejects ${source}`, () => {
        expect(hasUnsupportedServerLoading(source)).toBe(true);
    });
    test(`server linking rejects ${source}`, async () => {
        await expect(linkServer('example', 'server/main.cjs', new Map([['server/main.cjs', Buffer.from(source)]])))
            .rejects.toMatchObject({ name: 'CompositionLinkError', module: 'example' });
    });
}

test('server linking retains named errors for emitted loader references and warnings', async () => {
    for (const source of rejected.filter((source) => !source.includes('require("x")') && !source.includes('import("x")'))) {
        await expect(linkServer('example', 'server/main.cjs', new Map([['server/main.cjs', Buffer.from(source)]])))
            .rejects.toMatchObject({ name: 'CompositionLinkError', module: 'example',
                message: expect.stringContaining('dynamic loading is unsupported in a single script') });
    }
});

test('server linking accepts verified JSON containing loader prose and property keys', async () => {
    const files = new Map([
        ['server/main.cjs', Buffer.from('module.exports = require("./article.json");')],
        ['server/article.json', Buffer.from(JSON.stringify({ require: 'Articles require context', text: 'import(' }))],
    ]);
    const linked = await linkServer('example', 'server/main.cjs', files);
    expect(new Function(`return (${linked.factory})()`)()).toEqual({ require: 'Articles require context', text: 'import(' });
});
