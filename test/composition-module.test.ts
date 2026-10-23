import { test, expect, beforeAll } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import * as slimReact from '../src/slim-react/index';
import * as slimJsx from '../src/slim-react/jsx-runtime';
import { buildModule, provideShared, SHARED_GLOBAL, MODULES_GLOBAL } from '../src/composition';

const cwd = join(import.meta.dir, 'fixtures/composition-module');
const out = mkdtempSync(join(tmpdir(), 'hadars-composition-'));
const req = createRequire(import.meta.url);
let result: Awaited<ReturnType<typeof buildModule>>;

beforeAll(async () => {
    result = await buildModule({
        composition: { role: 'module', name: 'greeter', exposes: { greeting: 'src/index.tsx', page: 'src/page.tsx' } },
        cwd,
        outDir: out,
    });
}, 60_000);

test('writes a manifest per target listing the files to load', () => {
    expect(result.server.js).toEqual(['greeter.cjs']);
    expect(result.client.js).toEqual(['greeter.js']);
    expect(JSON.parse(readFileSync(join(out, 'server/manifest.json'), 'utf8'))).toEqual(result.server);
});

test('the server bundle uses the host React, not a private copy', async () => {
    provideShared({
        react: slimReact,
        'react/jsx-runtime': slimJsx,
        'react/jsx-dev-runtime': slimJsx,
    });
    const mod = req(join(out, 'server/greeter.cjs'));
    expect(mod.page.title).toBe('page');
    const { jsx } = slimJsx as any;
    const html = await slimReact.renderToString(
        jsx(mod.greeting.Ctx.Provider, { value: 'host', children: jsx(mod.greeting.Greeting, {}) }),
    );
    expect(html.replace(/<!-- -->/g, '')).toContain('hello host n=2');
});

test('the bundles contain no copy of react', () => {
    for (const f of ['server/greeter.cjs', 'client/greeter.js']) {
        const code = readFileSync(join(out, f), 'utf8');
        expect(code).toContain(SHARED_GLOBAL);
        expect(code).not.toContain('react.element');
    }
    expect(readFileSync(join(out, 'client/greeter.js'), 'utf8')).toContain(MODULES_GLOBAL);
});
