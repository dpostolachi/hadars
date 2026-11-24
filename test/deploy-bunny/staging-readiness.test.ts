import { expect, test } from 'bun:test';
import { BunnyTarget, probeTimeout } from '../../src/deploy/bunny';
import { readinessProbe } from '../../src/deploy/bunny/probe';
import { splitProvider } from './helpers/split';
import { mockProvider } from './helpers/mockProvider';

const settings = { key: 'mock', publicZoneId: '1', storageZone: 'assets', storageKey: 'mock' };
const revision = { project: 'demo', environment: 'dev', revision: 1, artifact: { entry: 'bunny.mjs', files: [{ path: 'bunny.mjs', bytes: Buffer.from('hello') }] } };

test('probe window validates bounds and backoff is exactly 1,2,4,8,10 capped by deadline', async () => {
    expect(probeTimeout()).toBe(120); expect(probeTimeout('600')).toBe(600);
    for (const n of [0, 601, -1, 'x', 1.5]) expect(() => probeTimeout(n)).toThrow();
    const sleeps: number[] = [];
    const error = await readinessProbe((async (_url: any) => new Response('private body', { status: 503 })) as typeof fetch, 'http://127.0.0.1/', 30, async ms => { sleeps.push(ms); }, undefined, () => 0);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000, 10000, 5000]);
    expect(error).toBe('HTTP 503 (timed out after 30s)');
});

test('split slow units run in parallel, publication placeholder lasts 30 seconds', async () => {
    const f = await splitProvider();
    let now = 0;
    const mock = mockProvider({ split: true, placeholderSeconds: 30, now: () => now });
    const zone = await mock.client.request('POST', '/pullzone', { Name: 'demo-dev', EdgeScriptId: 999, OriginType: 4, EnableSmartCache: true, IgnoreQueryStrings: false, DisableCookies: false, AddHostHeader: true });
    let batch: Promise<void> | undefined;
    const sleeps: number[] = [];
    const target = new BunnyTarget({ ...settings, publicZoneId: String(zone.Id) }, mock.send, mock.client, ms => {
        sleeps.push(ms!);
        // All waiters in a parallel round share the same virtual clock advance.
        if (!batch) batch = Promise.resolve().then(() => { now += ms!; batch = undefined; });
        return batch;
    });
    const staged = await target.stage(target.plan({ ...revision, artifact: f.fixture.artifact }));
    expect(await target.verify(staged)).toEqual({ ok: true });
    expect(now).toBe(35_000); expect(sleeps).toHaveLength(24);
    expect(mock.requests.slice(0, 3).every(r => r.url.endsWith('/__hadars/release'))).toBe(true);
});

test('wrong identity fails after three identical answers; placeholder, HTTP and network reasons stay per unit', async () => {
    const f = await splitProvider(); const staged = await f.target.stage(f.plan(), f.config);
    const original = f.mock.published.find(p => String(p.id) === staged.split!.groups[0].scriptId)!;
    await f.mock.client.publish(String(original.id), original.code.replace(staged.split!.releaseId, '0'.repeat(16)));
    const start = f.mock.requests.length;
    const result = await f.target.verify(staged, f.summary);
    expect(result.error).toContain('admin: wrong release in JSON (3 consecutive identical wrong answers)');
    expect(f.mock.requests.slice(start).filter(r => r.url.includes(staged.split!.groups[0].hostname))).toHaveLength(3);
    const send = (async (url: any) => {
        if (String(url).includes(staged.split!.groups[0].hostname)) return new Response('sensitive placeholder');
        if (String(url).includes(staged.split!.groups[1].hostname)) return new Response('sensitive', { status: 503 });
        throw new Error('secret network detail');
    }) as typeof fetch;
    const target = new BunnyTarget(settings, send, f.mock.client, async () => {}); target.probeTimeoutSeconds = 5;
    const failed = await target.verify(staged);
    expect(failed.error).toContain('admin: placeholder/unready body');
    expect(failed.error).toContain('shop: HTTP 503'); expect(failed.error).toContain('main: network error');
    expect(failed.error).not.toContain('sensitive'); expect(failed.error).not.toContain('secret');
});

test('resume reads code and exact config, reports reused, refuses modified code/value/secret names', async () => {
    const f = await splitProvider(); const first = await f.target.stage(f.plan(), f.config);
    f.target.beginAttempt();
    const resumed = await f.target.stage(f.plan(), f.config);
    expect(resumed.split!.groups).toEqual(first.split!.groups);
    expect(resumed.assets).toEqual({ reused: first.assets!.uploaded, uploaded: 0 });
    expect(f.target.attempt.resources.map(r => r.disposition)).toEqual(['reused', 'reused', 'reused']);
    await f.target.cleanupAttempt(); expect(f.target.attempt.resources.every(r => r.cleanup === 'kept')).toBe(true);
    const row = f.mock.tables['/compute/script'].find(r => String(r.Id) === first.split!.groups[0].scriptId)!;
    row.EdgeScriptVariables[0].DefaultValue = 'sensitive-changed';
    await expect(f.target.stage(f.plan(), f.config)).rejects.toThrow('non-secret variable mismatch: URL');
    row.EdgeScriptVariables[0].DefaultValue = f.config.variables.URL;
    row.Secrets = [];
    await expect(f.target.stage(f.plan(), f.config)).rejects.toThrow('secret names differ');
    row.Secrets = [{ Name: 'TOKEN' }];
    const p = f.mock.published.find(p => p.id === row.Id)!; p.code += '\n// edit';
    await expect(f.target.stage(f.plan(), f.config)).rejects.toThrow('code SHA-256 differs');
});

test('single unit cleanup keeps reused/live resources, removes created linked zones, retry succeeds', async () => {
    const mock = mockProvider(); const target = new BunnyTarget(settings, mock.send, mock.client, async () => {});
    const stage = await target.stage(target.plan(revision));
    expect(target.attempt.resources[0].linkedZoneIds).toHaveLength(1);
    await target.cleanupAttempt([], true); expect(target.attempt.resources[0].cleanup).toBe('kept');
    await target.cleanupAttempt([stage]); expect(target.attempt.resources[0].cleanup).toBe('kept');
    await target.cleanupAttempt(); expect(target.attempt.resources[0].cleanup).toBe('cleaned');
    expect(mock.tables['/compute/script']).toHaveLength(0); expect(mock.tables['/pullzone']).toHaveLength(0);
    await target.cleanupAttempt(); expect(target.attempt.resources[0].cleanup).toBe('cleaned');
    target.beginAttempt(); const retry = await target.stage(target.plan(revision));
    expect(await target.verify(retry)).toEqual({ ok: true });
    target.beginAttempt(); await target.stage(target.plan(revision));
    expect(target.attempt.resources[0].disposition).toBe('reused');
    await target.cleanupAttempt(); expect(mock.tables['/compute/script']).toHaveLength(1);
});

test('lost creation reply is journaled, failed deletion names remaining resources, cleanup retry is idempotent', async () => {
    const mock = mockProvider();
    const target = new BunnyTarget(settings, mock.send, mock.client, async () => {});
    // Immutable-name lookup succeeds, then creation succeeds but its response is lost.
    mock.armFailure(2, true);
    await expect(target.stage(target.plan(revision))).rejects.toThrow('lost reply');
    expect(target.attempt.resources).toHaveLength(1);
    const request = mock.client.request;
    mock.client.request = async (method, path, body) => {
        if (method === 'DELETE' && path.startsWith('/pullzone/')) throw new Error('mock delete denied');
        return request(method, path, body);
    };
    const attempt = await target.cleanupAttempt();
    expect(attempt.resources[0].cleanup).toBe('remaining');
    expect(attempt.resources[0].remaining).toEqual(['script 1', 'linked zone 2']);
    mock.client.request = request;
    expect((await target.cleanupAttempt()).resources[0].cleanup).toBe('cleaned');
    expect(mock.tables['/compute/script']).toHaveLength(0); expect(mock.tables['/pullzone']).toHaveLength(0);
});

test('single-unit publication placeholder retries, exact single-unit resume rejects drift and missing live scripts', async () => {
    let now = 0;
    const mock = mockProvider({ placeholderSeconds: 20, now: () => now });
    const target = new BunnyTarget(settings, mock.send, mock.client, async ms => { now += ms!; });
    const config = { variables: { URL: 'private-config-value' }, secrets: { TOKEN: 'private-secret-value' }, required: [] };
    const plan = target.plan(revision, config);
    const staged = await target.stage(plan, config);
    expect(await target.verify(staged, plan.configSummary)).toEqual({ ok: true });
    expect(now).toBe(25_000);
    target.beginAttempt(); await target.stage(plan, config);
    expect(target.attempt.resources[0].disposition).toBe('reused');
    mock.tables['/compute/script'][0].EdgeScriptVariables[0].DefaultValue = 'changed';
    await expect(target.stage(plan, config)).rejects.toThrow('non-secret variable mismatch: URL');
    mock.tables['/compute/script'] = [];
    await expect(target.stage(plan, config, true)).rejects.toThrow('missing script');
});

test('three identical wrong groups fail fast and a changed answer resets the counter', async () => {
    let count = 0;
    const sleeps: number[] = [];
    const error = await readinessProbe((async (_url: any) => Response.json({ release: 'expected', group: ++count === 2 ? 'second' : 'wrong', shell: 'shell' })) as typeof fetch,
        'http://127.0.0.1/', 120, async ms => { sleeps.push(ms); }, { release: 'expected', group: 'expected', shell: 'shell' });
    expect(error).toBe('wrong group in JSON (3 consecutive identical wrong answers)');
    expect(count).toBe(5); expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
});

test('ordinary HTML input placeholder attributes do not look like a provider placeholder', async () => {
    const error = await readinessProbe((async (_url: any) => new Response('<html><input placeholder="Search"><main>Application</main></html>')) as typeof fetch,
        'http://127.0.0.1/', 1, async () => { throw new Error('must be ready immediately'); });
    expect(error).toBeUndefined();
});
