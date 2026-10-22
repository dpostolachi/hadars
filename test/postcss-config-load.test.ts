/**
 * Guards the discriminator that tells "no PostCSS config" apart from "a config
 * is present but broken".
 *
 * `postcss-load-config` throws for both, and the two cannot be separated by
 * `err.code`: the benign no-config error carries no `code` at all, a missing
 * plugin package throws `ERR_MODULE_NOT_FOUND`, a plugin name that will not
 * resolve throws a plain wrapped Error, and a malformed config throws a
 * `SyntaxError` under Node but an `AggregateError` under Bun — both with no
 * `code`. A guard such as
 * `if (err?.code !== 'MODULE_NOT_FOUND')` therefore fires on every one of them,
 * benign case included. The thrown message is the only usable signal.
 *
 * Getting this wrong is expensive because it is silent: swallowing the failure
 * leaves the plugin list empty, `postcss([])` passes the CSS through unchanged,
 * and the build reports success. What you see is a stylesheet with Tailwind's
 * theme layers and zero utilities — which reads as "Tailwind is broken" and
 * sends you into the wrong layer entirely.
 *
 * Fixtures are built under the OS temp dir rather than in test/fixtures on
 * purpose: lilconfig's `search` walks UP the directory tree as far as
 * `os.homedir()`, so a fixture nested inside this repo would start finding a
 * postcss.config.js added at the repo root later and the no-config case would
 * silently stop testing what it claims to.
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import pathMod from 'node:path';
import { loadPostcssConfig } from '../src/utils/postcssConfig';

let root = '';

/** Runs `loadPostcssConfig` with cwd pointed at one of the fixture dirs. */
async function inFixture<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = process.cwd();
    process.chdir(pathMod.join(root, name));
    try {
        return await fn();
    } finally {
        process.chdir(prev);
    }
}

const write = (dir: string, files: Record<string, string>) =>
    Promise.all(Object.entries(files).map(([name, body]) =>
        fs.writeFile(pathMod.join(root, dir, name), body)));

beforeAll(async () => {
    root = await fs.mkdtemp(pathMod.join(os.tmpdir(), 'hadars-postcss-'));
    const dirs = ['no-config', 'missing-import', 'missing-plugin', 'malformed', 'valid'];
    await Promise.all(dirs.map(d => fs.mkdir(pathMod.join(root, d))));

    // A package.json with no "postcss" key is not a config as far as lilconfig is
    // concerned, so no-config stays a genuine no-config case.
    const pkg = JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module' });
    await Promise.all(dirs.map(d => write(d, { 'package.json': pkg })));

    await write('missing-import', {
        // The real-world shape: the config imports a package that is not installed.
        'postcss.config.js':
            "import autoprefixer from 'hadars-absent-pkg';\nexport default { plugins: [autoprefixer] };\n",
    });
    await write('missing-plugin', {
        // Object form — postcss-load-config resolves the name itself and wraps the
        // failure in a plain Error with no `code`.
        'postcss.config.js': "export default { plugins: { 'hadars-absent-pkg': {} } };\n",
    });
    await write('malformed', {
        'postcss.config.js': 'export default { plugins: [ this is not valid js\n',
    });
    await write('valid', {
        'postcss.config.js':
            "export default { plugins: [{ postcssPlugin: 'hadars-test-noop', Once() {} }] };\n",
    });
});

afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
});

test('no config present is benign — no plugins, no throw', async () => {
    const { plugins, fingerprint } = await inFixture('no-config', loadPostcssConfig);
    expect(plugins).toEqual([]);
    expect(fingerprint).toBe('no-config');
});

test('a config importing an uninstalled package throws, attributed to PostCSS', async () => {
    const err = await inFixture('missing-import', () =>
        loadPostcssConfig().then(() => null, (e: Error) => e));

    expect(err).toBeInstanceOf(Error);
    // The failure must name the real cause. Surfacing as empty CSS is the bug.
    expect(err!.message).toContain('UNPROCESSED');
    expect(err!.message).toContain('hadars-absent-pkg');
    expect((err!.cause as any)?.code).toBe('ERR_MODULE_NOT_FOUND');
});

test('a config naming an unresolvable plugin throws', async () => {
    const err = await inFixture('missing-plugin', () =>
        loadPostcssConfig().then(() => null, (e: Error) => e));

    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('UNPROCESSED');
    // No `code` here at all — which is exactly why `code` cannot be the guard.
    expect((err!.cause as any)?.code).toBeUndefined();
});

test('a malformed config throws rather than passing CSS through', async () => {
    const err = await inFixture('malformed', () =>
        loadPostcssConfig().then(() => null, (e: Error) => e));

    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('UNPROCESSED');
    // Deliberately not asserting the cause's class: a config that will not parse
    // surfaces as SyntaxError under Node and AggregateError under Bun. That spread
    // is the point — the error class is not something a guard can key off, which
    // is why the benign case is matched by message instead.
    expect(err!.cause).toBeDefined();
});

test('a valid config loads its plugins', async () => {
    const { plugins, fingerprint } = await inFixture('valid', loadPostcssConfig);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].postcssPlugin).toBe('hadars-test-noop');
    expect(fingerprint).toContain('hadars-test-noop');
});

test('the fingerprint changes when the config changes', async () => {
    const before = (await inFixture('valid', loadPostcssConfig)).fingerprint;

    await write('valid', {
        'postcss.config.js':
            "export default { plugins: [{ postcssPlugin: 'hadars-test-other', Once() {} }] };\n",
    });
    const after = (await inFixture('valid', loadPostcssConfig)).fingerprint;

    // The processed template is cached under a key built from this fingerprint.
    // If it did not move, fixing postcss.config.js would leave the stale
    // passthrough output in place and the repair would look like it did nothing.
    expect(after).not.toBe(before);
});
