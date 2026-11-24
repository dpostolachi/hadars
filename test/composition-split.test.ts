import { describe, test, expect } from 'bun:test';
import { matchGroup, routingPlan, splitGroups, type SplitOptions } from '../src/composition/split';
import { splitHandler } from '../src/composition/splitRuntime';
import type { PinnedBuild } from '../src/composition/pinnedTypes';
const builds = Object.fromEntries(['admin', 'shop', 'browser'].map(name => [name, { name, kind: 'module', clientOnly: name === 'browser' }])) as Record<string, PinnedBuild>;
const config: SplitOptions = { mode: 'per-module', defaultGroup: 'main', mounts: { admin: ['/admin/**'], shop: ['/shop/**'] } };
const routes = () => ({ defaultGroup: 'main', groups: splitGroups(config, builds)! });
test('plan orders longer prefixes, name ties, and default last', () => {
    expect(routingPlan(routes())).toEqual([{ group: 'admin', patterns: ['/admin/**'] }, { group: 'shop', patterns: ['/shop/**'] }, { group: 'main', patterns: [] }]);
    expect(splitGroups(undefined)).toBeUndefined();
    expect(splitGroups({ mode: 'single' })).toBeUndefined();
});
describe('raw pathname grammar and boundaries', () => {
    for (const [path, expected] of Object.entries({ '/admin': 'admin', '/admin/': 'admin', '/admin/a/b': 'admin', '/admin?x=1#test': 'admin', '/administrator': 'main', '/admin2': 'main', '/ADMIN': 'main', '/': 'main', '/admin//x': 'admin', '//admin': 'main', '/%61dmin': 'main', '/admin%2Fx': 'main', '/admin/%2F': 'admin', '/admin/../shop': 'admin', '/shop': 'shop', '/unknown?admin': 'main' })) {
        test(path, () => expect(matchGroup(routes(), path)).toBe(expected));
    }
    test('literal exact and same-group overlap', () => {
        const groups = splitGroups({ ...config, mounts: { admin: ['/admin/**', '/admin/deep/**'], shop: ['/exact'] } }, builds)!;
        const manifest = { defaultGroup: 'main', groups };
        for (const [path, group] of [['/', 'main'], ['/admin/deep', 'admin'], ['/admin/deeper', 'admin'], ['/exact', 'shop'], ['/exact/', 'main']]) expect(matchGroup(manifest, path!)).toBe(group!);
    });
});
test('configuration fails clearly', () => {
    const invalid: Array<[any, string]> = [
        [{ ...config, mode: 'other' }, 'MODE'], [{ ...config, defaultGroup: '' }, 'DEFAULT'],
        [{ ...config, defaultGroup: 'admin' }, 'COLLISION'], [{ ...config, mounts: { nope: ['/a'] } }, 'UNKNOWN'],
        [{ ...config, mounts: { admin: ['/a'] } }, 'UNMOUNTED'], [{ ...config, budgets: { unitBytes: 0 } }, 'BUDGET'],
        [{ ...config, mounts: { admin: [] , shop: ['/a'] } }, 'PATTERNS'],
        [{ ...config, mounts: { admin: ['/a'], shop: ['/a/**'] } }, 'NESTED'],
    ];
    for (const [value, message] of invalid) expect(() => splitGroups(value, builds)).toThrow(message);
    expect(() => splitGroups(config)).toThrow('PINNED');
    for (const pattern of ['', 'admin', '/admin/', '/a//b', '/a/*', '/**', '/a/:id', '/a?x', '/a#x', '/a/%20', '/a/中文', '/a\\b']) {
        expect(() => splitGroups({ ...config, mounts: { admin: [pattern], shop: ['/shop'] } }, builds)).toThrow('PATTERN');
    }
    expect(() => routingPlan({ defaultGroup: 'missing', groups: [] })).toThrow('DEFAULT_MISSING');
});
test('probe bypasses every hook and identity headers cover immutable responses', async () => {
    let calls = 0;
    const identity = { release: '0123456789abcdef', group: 'admin', shell: 'shell' };
    const handler = splitHandler(async () => { calls++; return Response.redirect('https://example.invalid'); }, identity);
    const probe = await handler(new Request('http://local/__hadars/release?x=1'));
    expect(await probe.json()).toEqual(identity);
    expect(calls).toBe(0);
    expect(probe.headers.get('cache-control')).toBe('no-store');
    const response = await handler(new Request('http://local/anything'));
    expect(calls).toBe(1);
    expect(response.status).toBe(302);
    expect(response.headers.get('x-hadars-release')).toBe(identity.release);
    expect(response.headers.get('x-hadars-group')).toBe('admin');
});

test('cross-group nesting rejects either direction, root and multi-mount masking; same group may overlap', () => {
    for (const mounts of [
        { admin: ['/a/**', '/very-long/**'], shop: ['/a/b/**'] },
        { admin: ['/a/b'], shop: ['/a'] },
        { admin: ['/'], shop: ['/b'] },
        { admin: ['/a'], shop: ['/a'] },
    ]) expect(() => splitGroups({ ...config, mounts }, builds)).toThrow('SPLIT_PATTERN_NESTED:');
    expect(splitGroups({ ...config, mounts: { admin: ['/a', '/a/**', '/a/b/**'], shop: ['/ab/**'] } }, builds)).toHaveLength(3);
});

test('seeded prefix-free mounts: ordered plan, longest prefix and expanded native rules agree', () => {
    let seed = 0x8ab34;
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    for (let run = 0; run < 120; run++) {
        const mounts: Record<string, string[]> = {};
        for (const name of ['admin', 'shop']) mounts[name] = Array.from({ length: 1 + random(4) }, (_, i) => `/${name}${i}${'x'.repeat(random(9))}/s${random(20)}${random(2) ? '/**' : ''}`);
        const manifest = { defaultGroup: 'main', groups: splitGroups({ ...config, mounts }, builds)! };
        const patterns = manifest.groups.flatMap(g => g.patterns.map(pattern => ({ group: g.name, pattern })));
        const expanded = routingPlan(manifest).flatMap(g => g.patterns.flatMap(p => p.endsWith('/**')
            ? [{ group: g.group, exact: p.slice(0, -3) }, { group: g.group, starts: p.slice(0, -3) + '/' }]
            : [{ group: g.group, exact: p }]));
        const witnesses = patterns.flatMap(({ pattern }) => {
            const p = pattern.replace(/\/\*\*$/, '');
            return [p, p + '/', p + '/child', p + 'x', p.toUpperCase(), p + '//x', p + '/%2F', p + '%2Fx', p + '?q#f', p + '/../x'];
        });
        for (let i = 0; i < 60; i++) witnesses.push(`/${random(2) ? 'admin' : 'shop'}${random(6)}/s${random(20)}/${random(9)}`);
        for (const pathname of witnesses) {
            const raw = pathname.split(/[?#]/)[0]!;
            const longest = patterns.filter(({ pattern: p }) => p.endsWith('/**') ? raw === p.slice(0, -3) || raw.startsWith(p.slice(0, -3) + '/') : raw === p)
                .sort((a, b) => b.pattern.replace(/\/\*\*$/, '').length - a.pattern.replace(/\/\*\*$/, '').length)[0]?.group ?? 'main';
            const native = expanded.find(rule => 'exact' in rule ? raw === rule.exact : raw.startsWith(rule.starts!))?.group ?? 'main';
            expect(matchGroup(manifest, pathname)).toBe(longest);
            expect(native).toBe(longest);
        }
    }
});
