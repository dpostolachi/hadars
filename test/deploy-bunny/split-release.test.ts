import { snapshotIdFor } from '../../src/deploy/bunny/identity';
import { outputHash, outputCanonical, outputDigest } from '../../src/deploy/bunny/output';
import { test, expect } from 'bun:test';
import { splitProvider } from './helpers/split';
import { SplitActivationError, validateReceipt } from '../../src/deploy/bunny/split-release';
import { BunnyTarget, staticLayout } from '../../src/deploy/bunny';

test('three actual fixture units: full stage/config/static, activation, redeploy and rollback', async () => {
    const f = await splitProvider(8), { mock, target, config, summary } = f;
    const stage1 = await target.stage(f.plan(), config);
    expect(stage1.split?.groups).toHaveLength(3);
    const uploads = staticLayout(f.fixture.artifact).files;
    expect(stage1.assets?.uploaded).toBe(uploads.length);
    expect(uploads.some(f => f.path.endsWith('/index.js'))).toBe(true);
    expect(uploads.some(f => /(?:^|\/)(shell|units)(?:\/|$)|(?:^|\/)(hadars.lock|composition-provenance.json)$/.test(f.path))).toBe(false);
    expect([...mock.objects.keys()].sort()).toEqual(uploads.map(f => '/assets/' + f.path).sort());
    expect(mock.published).toHaveLength(4);
    expect(mock.tables['/pullzone'].find(z => z.Id === f.zone.Id)?.EdgeScriptId).toBe(1);
    expect(await target.verify(stage1, summary)).toEqual({ ok: true });
    validateReceipt(stage1.split!, 'demo-dev-r1', stage1);
    const before = mock.managementRequests.length;
    const immutable = structuredClone(stage1);
    expect(stage1.split!.rules.every(r => !Object.hasOwn(r, 'Guid'))).toBe(true);
    await target.activate(stage1);
    const firstRules = structuredClone(target.activationRules!);
    expect(stage1).toEqual(immutable);
    expect(firstRules).toHaveLength(4);
    expect(stage1.split!.rules.map(r => r.Description)).toEqual(['hadars:demo:dev:admin:0:0', 'hadars:demo:dev:admin:1:0', 'hadars:demo:dev:shop:0:0', 'hadars:demo:dev:shop:1:0']);
    for (const g of stage1.split!.plan.filter(g => g.patterns.length)) {
        const rules = stage1.split!.rules.filter(r => r.Description.startsWith(stage1.split!.owner + g.group + ':'));
        expect(rules).toHaveLength(g.patterns.length);
        expect(rules.every(r => r.Triggers[0].PatternMatches.length <= 3)).toBe(true);
        expect(rules.map(r => r.Triggers[0].PatternMatches[0])).toEqual([...g.patterns].sort().map(p => 'https://demo-dev.b-cdn.net' + p.replace(/\/\*\*$/, '')));
    }
    const writes = mock.managementRequests.slice(before).filter(c => c.method !== 'GET');
    expect(writes.map(c => c.path)).toEqual([...Array(4).fill(`/pullzone/${f.zone.Id}/edgerules/addOrUpdate`), `/pullzone/${f.zone.Id}`, `/pullzone/${f.zone.Id}/purgeCache`]);
    expect(writes.slice(0, 4).every(c => !Object.hasOwn(c.body, 'Guid'))).toBe(true);
    expect(target.activationProbes?.checked).toBeGreaterThan(15);
    const stage2 = await target.stage(f.plan(2), config);
    expect(stage2.assets).toEqual({ reused: uploads.length, uploaded: 0 });
    expect(await target.verify(stage2, summary)).toEqual({ ok: true });
    await target.activate(stage2, { previous: stage1 });
    expect(stage2.split!.rules.map(r => r.Guid)).toEqual(firstRules.map(r => r.Guid));
    expect(target.activationRules).toEqual(firstRules);
    await target.rollback({ ...stage1, liveRules: firstRules }, { previous: { ...stage2, liveRules: target.activationRules } });
    const current = await mock.client.request('GET', `/pullzone/${f.zone.Id}`);
    expect(current.EdgeRules.map((r: any) => r.Guid)).toEqual(firstRules.map(r => r.Guid));
    expect(current.EdgeScriptId).toBe(Number(stage1.scriptId));
    expect(current.EdgeRules.map((r: any) => r.ActionParameter1)).toEqual(stage1.split!.rules.map(r => r.ActionParameter1));
});

test('loopback-only provider transport executes actual unit probes through the public zone', async () => {
    const f = await splitProvider(5);
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        const data = await request.json() as any;
        try {
            if (data.kind === 'management') return Response.json(await f.mock.client.request(data.method, data.path, data.body));
            if (data.kind === 'publish') { await f.mock.client.publish(data.id, data.code); return Response.json(null); }
            return await f.mock.send(data.url, data.init);
        } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
    } });
    const rpc = async (body: any) => { const response = await fetch(server.url, { method: 'POST', body: JSON.stringify(body) }); if (!response.ok) throw new Error('Local provider failure'); return response; };
    const send = (async (url: any, init: any) => {
        // All storage bodies use bytes; encode and decode via explicit RPC separately.
        if (String(url).includes('storage.bunnycdn.com')) return f.mock.send(url, init);
        return rpc({ kind: 'send', url: String(url), init: { redirect: init?.redirect, headers: init?.headers } });
    }) as typeof fetch;
    const client = { request: async (method: string, path: string, body?: any) => (await rpc({ kind: 'management', method, path, body })).json(), publish: async (id: string, code: string) => { await rpc({ kind: 'publish', id, code }); } };
    const target = new BunnyTarget({ key: 'mock', publicZoneId: String(f.zone.Id), storageZone: 'assets', storageKey: 'mock' }, send, client, async () => { f.mock.advance(); });
    try {
        const staged = await target.stage(f.plan(), f.config);
        expect((await target.verify(staged, f.summary)).ok).toBe(true);
        await target.activate(staged);
        expect(target.activationProbes?.release).toBe(staged.split!.releaseId);
    } finally { await server.stop(true); }
});

test('failure before and after every live write/readback/purge restores prior state in reverse order', async () => {
    for (const after of [false, true]) for (let step = 1; step <= 8; step++) {
        const f = await splitProvider();
        const old = await f.target.stage(f.plan(), f.config); await f.target.activate(old);
        const staged = await f.target.stage(f.plan(2), f.config);
        const before = await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`);
        // Two preflight reads, four rules, pointer, readback, purge, first probe.
        const start = f.mock.managementRequests.length;
        f.mock.armFailure(step + 2, after);
        let error: unknown;
        try { await f.target.activate(staged, { previous: old }); } catch (e) { error = e; }
        // A transient failed HTTP probe is retried; management failure always rolls back.
        if (step < 8) {
            expect(error instanceof SplitActivationError, `step ${step}, after=${after}`).toBe(true);
            expect((error as SplitActivationError).restored).toBe(true);
            const current = await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`);
            expect(current.EdgeRules).toEqual(before.EdgeRules); expect(current.EdgeScriptId).toBe(before.EdgeScriptId);
            const calls = f.mock.managementRequests.slice(start).filter(c => c.method !== 'GET');
            const rollbackPointer = calls.map(c => c.path === `/pullzone/${f.zone.Id}` && c.body.EdgeScriptId === before.EdgeScriptId).lastIndexOf(true);
            if (step >= 5) expect(rollbackPointer).toBeGreaterThanOrEqual(0);
            expect(calls.some(c => c.method === 'DELETE' && c.path.startsWith('/compute/script'))).toBe(false);
        }
    }
});

test('units stage together, yet journal writes never go backwards and a failed unit leaves every created script recorded', async () => {
    const ok = await splitProvider();
    const writes: number[] = [];
    let running = 0, overlap = 0;
    ok.target.beginAttempt();
    ok.target.onAttempt = async attempt => {
        running++; overlap = Math.max(overlap, running);
        await new Promise(r => setTimeout(r, Math.random() * 5));
        writes.push(attempt.resources.length);
        running--;
    };
    const staged = await ok.target.stage(ok.plan(), ok.config);
    expect(overlap).toBe(1);
    expect(writes).toEqual([...writes].sort((a, b) => a - b));
    expect(writes.at(-1)).toBe(staged.split!.groups.length);
    expect(ok.target.attempt.resources.map(r => r.name).sort()).toEqual(staged.split!.groups.map(g => g.name).sort());

    const sample = await splitProvider(); sample.mock.armFailure(-1);
    await sample.target.stage(sample.plan(), sample.config);
    const count = sample.mock.operationCount;
    for (let step = 1; step <= count; step++) {
        const f = await splitProvider(); f.mock.armFailure(step, false);
        const last: number[] = [0];
        f.target.beginAttempt();
        f.target.onAttempt = async attempt => { last[0] = attempt.resources.length; };
        await expect(f.target.stage(f.plan(), f.config)).rejects.toThrow();
        // Whatever was created before the failure is in the last journal write, and nothing was written after the stage ended.
        expect(last[0]).toBe(f.target.attempt.resources.length);
    }
});
test('stage failures at every provider/storage/config/publish step never alter live state', async () => {
    const sample = await splitProvider(); sample.mock.armFailure(-1);
    await sample.target.stage(sample.plan(), sample.config);
    const count = sample.mock.operationCount;
    for (const after of [false, true]) for (let step = 1; step <= count; step++) {
        const f = await splitProvider(); f.mock.armFailure(step, after);
        await expect(f.target.stage(f.plan(), f.config)).rejects.toThrow();
        expect(f.mock.tables['/pullzone'].find(z => z.Id === f.zone.Id)?.EdgeScriptId).toBe(1);
        expect(f.mock.managementRequests.some(c => c.path.includes('/edgerules/'))).toBe(false);
    }
});

test('persistent public near-miss mismatch rolls back; explicit no-auto-rollback preserves uncertain state', async () => {
    for (const noAutoRollback of [false, true]) {
        const f = await splitProvider();
        const old = await f.target.stage(f.plan(), f.config); await f.target.activate(old);
        const staged = await f.target.stage(f.plan(2), f.config);
        // Corrupt only the new admin unit after successful staging; the previous unit still probes correctly.
        const published = f.mock.published.find(p => String(p.id) === staged.split!.groups[0].scriptId)!;
        const original = published.code;
        const wrong = original.replace(/(\w+)\.set\("x-hadars-group",\w+\.group\)/, '$1.set("x-hadars-group","wrong")');
        expect(wrong).not.toBe(original);
        await f.mock.client.publish(String(published.id), wrong);
        await expect(f.target.activate(staged, { previous: old, noAutoRollback })).rejects.toThrow(noAutoRollback ? 'disabled' : 'restored');
        const zone = await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`);
        expect(zone.EdgeScriptId).toBe(Number(noAutoRollback ? staged.scriptId : old.scriptId));
    }
});

test('foreign rules stay byte-identical; obsolete owned rules disable without changing their order', async () => {
    const { resealSplit } = await import('./helpers/split');
    const f = await splitProvider();
    const foreign = { Guid: '11111111-1111-4111-8111-111111111111', Description: 'operator rule', ActionType: 0, Enabled: true, Triggers: [], OrderIndex: 0 };
    f.mock.tables['/pullzone'].find(z => z.Id === f.zone.Id)!.EdgeRules.push(foreign);
    const old = await f.target.stage(f.plan(), f.config); await f.target.activate(old);
    const artifact = resealSplit(f.fixture.artifact, (m, metadata, a) => {
        m.groups = m.groups.filter((g: any) => g.name !== 'shop');
        const id = metadata.modules.shop.buildId;
        delete metadata.modules.shop;
        const lockFile = a.files.find(f => f.path === 'hadars.lock')!;
        const lock = JSON.parse(new TextDecoder().decode(lockFile.bytes));
        delete lock.snapshot.modules.shop; delete lock.builds[id];
        lock.snapshot.id = snapshotIdFor(lock.snapshot); lock.snapshotId = lock.snapshot.id;
        lock.snapshotSha256 = outputHash(outputCanonical(lock.snapshot));
        lockFile.bytes = Buffer.from(JSON.stringify(lock));
        m.snapshot = metadata.snapshot = lock.snapshotId;
        a.files = a.files.filter(file => file.path !== 'units/shop/bunny.mjs' && !file.path.startsWith(`_builds/${id}/`));
        metadata.output.static.files = metadata.output.static.files.filter((f: any) => !f.path.startsWith(`_builds/${id}/`));
        metadata.output.static.sha256 = outputDigest(metadata.output.static.files);
        metadata.output.shell = metadata.output.shell.map((f: any) => f.path === 'hadars.lock' ? { path: f.path, size: lockFile.bytes.length, sha256: outputHash(lockFile.bytes) } : f);
    });
    const plan = f.target.plan({ project: 'demo', environment: 'dev', revision: 2, artifact }, f.config);
    const staged = await f.target.stage(plan, f.config); await f.target.activate(staged, { previous: old });
    let current = await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`);
    expect(current.EdgeRules[0]).toEqual(foreign);
    const shop = current.EdgeRules.find((r: any) => r.Description.endsWith(':shop:0:0'));
    const shopGuid = shop.Guid;
    expect(shop).toMatchObject({ Enabled: false, ActionParameter1: staged.scriptId, OrderIndex: 3 });
    await f.target.rollback(old, { previous: staged });
    current = await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`);
    expect(current.EdgeRules[0]).toEqual(foreign);
    expect(current.EdgeRules[3]).toMatchObject({ Guid: shopGuid, Enabled: true, ActionParameter1: old.split!.groups[1].scriptId, OrderIndex: 3 });
});

test('retention deletes whole old recorded releases; every live/previous group and foreign script survives', async () => {
    const f = await splitProvider();
    const stages = [];
    for (let revision = 1; revision <= 8; revision++) {
        const stage = await f.target.stage(f.plan(revision), f.config);
        await f.target.activate(stage, { previous: stages.at(-1) }); stages.push(stage);
    }
    const lookalike = await f.mock.client.request('POST', '/compute/script', { Name: 'demo-dev-r0-foreign' });
    await f.target.retain('demo', 'dev', stages[7].scriptId, stages[0].scriptId, [stages[7], stages[0]], stages);
    const scripts = await f.target.scripts();
    for (const stage of [stages[0], ...stages.slice(4)]) for (const g of stage.split!.groups) expect(scripts.some(s => String(s.Id) === g.scriptId)).toBe(true);
    for (const stage of stages.slice(1, 4)) for (const g of stage.split!.groups) expect(scripts.some(s => String(s.Id) === g.scriptId)).toBe(false);
    expect(scripts.some(s => s.Id === lookalike.Id)).toBe(true);
    for (const rule of f.mock.tables['/pullzone'].find(z => z.Id === f.zone.Id)!.EdgeRules) expect(scripts.some(s => String(s.Id) === rule.ActionParameter1)).toBe(true);
});

test('unsafe zone settings, wrong origin, invalid hostnames and unit budget fail before staging mutations', async () => {
    for (const change of [{ EnableSmartCache: false }, { IgnoreQueryStrings: true }, { DisableCookies: true }, { AddHostHeader: false }, { OriginType: 0 }, { Hostnames: [{ Value: 'invalid' }] }]) {
        const f = await splitProvider();
        Object.assign(f.mock.tables['/pullzone'].find(z => z.Id === f.zone.Id)!, change);
        const before = f.mock.published.length;
        await expect(f.target.stage(f.plan(), f.config)).rejects.toThrow();
        expect(f.mock.published).toHaveLength(before); expect(f.mock.objects.size).toBe(0);
    }
    const { resealSplit } = await import('./helpers/split');
    const f = await splitProvider();
    const artifact = resealSplit(f.fixture.artifact, m => { m.budgets.unitBytes = Math.min(...m.groups.map((g: any) => g.unit.size)) - 1; });
    expect(() => f.target.plan({ project: 'demo', environment: 'dev', revision: 1, artifact }, f.config)).toThrow('SPLIT_SIZE_EXCEEDED');
});

test('lost purge reply restores pointer then groups in exact reverse order; first deployment removes only its new rules', async () => {
    for (const hasPrevious of [false, true]) {
        const f = await splitProvider();
        const old = hasPrevious ? await f.target.stage(f.plan(), f.config) : undefined;
        if (old) await f.target.activate(old);
        const staged = await f.target.stage(f.plan(2), f.config);
        const start = f.mock.managementRequests.length;
        f.mock.armFailure(9, true); // zone+script reads, 4 rules, pointer, readback, purge (lost reply)
        await expect(f.target.activate(staged, { previous: old })).rejects.toThrow('restored');
        const mutations = f.mock.managementRequests.slice(start).filter(c => c.method !== 'GET');
        const undone = mutations.slice(6, 11);
        expect(undone[0].path).toBe(`/pullzone/${f.zone.Id}`);
        if (old) {
            expect(undone[1].body.ActionParameter1).toBe(old.split!.groups[1].scriptId);
            expect(undone[4].body.ActionParameter1).toBe(old.split!.groups[0].scriptId);
        } else {
            expect(undone.slice(1).every(c => c.method === 'DELETE' && /[a-f0-9-]{36}$/.test(c.path))).toBe(true);
            expect((await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`)).EdgeRules).toEqual([]);
            expect(staged.split!.rules.every(r => !r.Guid)).toBe(true);
        }
    }
});
test('all public aliases are probed with concrete host routing', async () => {
    const f = await splitProvider();
    f.mock.tables['/pullzone'].find(z => z.Id === f.zone.Id)!.Hostnames.push({ Value: 'custom.example' });
    const staged = await f.target.stage(f.plan(), f.config);
    await f.target.activate(staged);
    expect(staged.split!.publicHostnames).toEqual(['custom.example', 'demo-dev.b-cdn.net']);
    expect(staged.split!.rules[0].Triggers[0].PatternMatches.some(p => p.startsWith('https://custom.example/admin'))).toBe(true);
    expect(f.target.activationProbes!.checked).toBe(staged.split!.probes.length * 2);
});

test('static GC preserves any extant group and keeps shared roots excluded', async () => {
    const { gcCandidates } = await import('../../src/deploy/bunny/gc');
    const f = await splitProvider(), staged = await f.target.stage(f.plan(), f.config);
    const path = '_shell/' + 'a'.repeat(64) + '/out.html';
    const record = { id: 'old', environment: 'dev', revision: 1, target: 'bunny' as const, status: 'superseded' as const, actor: 'test', startedAt: 0, artifactSummary: { files: 1, bytes: 1 }, staticPaths: [path], staged };
    const scripts = [{ Id: Number(staged.split!.groups[0].scriptId), Name: staged.split!.groups[0].name }];
    const objects = [{ path, lastChanged: 0 }, { path: 'asset.12345678.js', lastChanged: 0 }];
    expect(gcCandidates([record], scripts, 'demo', objects, 0, 10000, 0, true)).toEqual([]);
    expect(gcCandidates([record], [], 'demo', objects, 0, 10000, 0, true)).toEqual([path]);
});

test('a mount shadowing the default public release probe is rejected before provider calls', async () => {
    const { resealSplit } = await import('./helpers/split');
    const f = await splitProvider(), calls = f.mock.calls.length;
    const artifact = resealSplit(f.fixture.artifact, m => { m.groups[0].patterns = ['/__hadars/**']; });
    expect(() => f.target.plan({ project: 'demo', environment: 'dev', revision: 1, artifact }, f.config)).toThrow('shadows the required default public release probe');
    expect(f.mock.calls).toHaveLength(calls);
});


test('mock parity: Guid is update-only; creation returns provider identity', async () => {
    const f = await splitProvider();
    const staged = await f.target.stage(f.plan(), f.config);
    const path = `/pullzone/${f.zone.Id}/edgerules/addOrUpdate`;
    await expect(f.mock.client.request('POST', path, { ...staged.split!.rules[0], Guid: crypto.randomUUID() })).rejects.toThrow('404');
    await expect(f.mock.client.request('POST', path, { ...staged.split!.rules[0], Guid: '' })).rejects.toThrow('404');
    const created = await f.mock.client.request('POST', path, staged.split!.rules[0]);
    expect(created.Guid).toMatch(/^[a-f0-9-]{36}$/);
    expect(created.Description).toBe(staged.split!.rules[0].Description);
});

test('first create failure and lost reply undo by actual provider Guid without mutating receipt', async () => {
    for (const [step, after] of [[3, true], [4, false]] as const) {
        const f = await splitProvider();
        const staged = await f.target.stage(f.plan(), f.config);
        const snapshot = structuredClone(staged);
        f.mock.armFailure(step, after); // two preflight reads, first create, second create
        await expect(f.target.activate(staged)).rejects.toThrow('restored');
        expect(staged).toEqual(snapshot);
        const zone = await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`);
        expect(zone.EdgeRules).toEqual([]);
        expect(f.mock.managementRequests.some(c => c.method === 'DELETE' && /edgerules\/[a-f0-9-]{36}$/.test(c.path))).toBe(true);
    }
});


test('known existing GUIDs are cross-checked; legacy embedded-Guid receipts remain valid', async () => {
    const { validateLiveRules } = await import('../../src/deploy/bunny/split-release');
    const f = await splitProvider();
    const first = await f.target.stage(f.plan(), f.config);
    await f.target.activate(first);
    const second = await f.target.stage(f.plan(2), f.config);
    validateReceipt(second.split!, 'demo-dev-r2', second);
    validateLiveRules(second.split!, f.target.activationRules!);
    const wrong = structuredClone(f.target.activationRules!);
    wrong[0].Guid = crypto.randomUUID();
    expect(() => validateLiveRules(second.split!, wrong)).toThrow('GUID');
    const legacy = structuredClone(second);
    delete legacy.liveRules;
    await f.target.activate(legacy, { previous: first });
    expect(f.target.activationRules!.map(r => r.Guid)).toEqual(second.split!.rules.map(r => r.Guid!));
});

test('seven-hostname three-group release packs two hosts per descendant rule and advisory bypass cannot roll back', async () => {
    const { resealSplit } = await import('./helpers/split');
    const { wildcardMatch } = await import('../../src/deploy/bunny/split');
    const f = await splitProvider();
    const zone = f.mock.tables['/pullzone'].find(z => z.Id === f.zone.Id)!;
    zone.Hostnames.push(...['s1.bunny.run', 'a.example', 'b.example', 'c.example', 'd.example', 'e.example'].map(Value => ({ Value })));
    const artifact = resealSplit(f.fixture.artifact, m => { for (const g of m.groups) if (g.patterns.length) g.patterns = [g.patterns.find((p: string) => p.endsWith('/**'))]; });
    const staged = await f.target.stage(f.target.plan({ project: 'demo', environment: 'dev', revision: 1, artifact }, f.config), f.config);
    expect(staged.split!.version).toBe(3);
    expect(staged.split!.groups).toHaveLength(3);
    expect(staged.split!.rules).toHaveLength(8);
    for (const r of staged.split!.rules) expect(r.Triggers[0].PatternMatches.length).toBeLessThanOrEqual(5);
    for (const { Value: host } of zone.Hostnames) {
        const patterns = staged.split!.rules.filter(r => r.Description.includes(':admin:')).flatMap(r => r.Triggers[0].PatternMatches);
        for (const path of ['/admin', '/admin/', '/admin/x', '/admin?x=1', '/admin/x?y=2']) expect(patterns.some(p => wildcardMatch(p, `https://${host}${path}`))).toBe(true);
        for (const path of ['/administrator', '/admin2', '/ADMIN', '/x/admin']) expect(patterns.some(p => wildcardMatch(p, `https://${host}${path}`))).toBe(false);
    }
    await f.target.activate(staged);
    expect(f.target.activationProbes!.checked).toBe(staged.split!.probes.length * 6);
    expect(f.target.activationProbes!.advisory).toEqual([{ hostname: 's1.bunny.run', checked: staged.split!.probes.length, failed: staged.split!.probes.length }]);
    expect(zone.EdgeScriptId).toBe(Number(staged.scriptId));
});

test('legacy group descriptions migrate in place, rollback restores legacy receipt and failures undo each migration step', async () => {
    const { resealSplit } = await import('./helpers/split');
    const { receipt } = await import('../../src/deploy/bunny/split-release');
    for (const after of [false, true]) for (const failStep of [0, 3, 4, 5, 6, 7]) {
        const f = await splitProvider();
        const artifact = resealSplit(f.fixture.artifact, m => { for (const g of m.groups) g.patterns = g.patterns.slice(0, 1); });
        const plan = f.target.plan({ project: 'demo', environment: 'dev', revision: 1, artifact }, f.config);
        const old = await f.target.stage(plan, f.config);
        old.split = receipt(plan.splitManifest!, 'demo', 'dev', old.split!.configDigest, old.split!.groups, await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`), true);
        validateReceipt(old.split, 'demo-dev-r1', old);
        await f.target.activate(old);
        old.liveRules = structuredClone(f.target.activationRules);
        const before = await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`);
        const next = await f.target.stage({ ...plan, revision: 2, name: 'demo-dev-r2' }, f.config);
        expect(next.split!.rules.map(r => r.Guid)).toEqual(old.liveRules!.map(r => r.Guid));
        if (failStep) {
            f.mock.armFailure(failStep, after);
            await expect(f.target.activate(next, { previous: old })).rejects.toThrow('restored');
            const restored = await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`);
            expect(restored.EdgeRules).toEqual(before.EdgeRules);
            expect(restored.EdgeScriptId).toBe(before.EdgeScriptId);
        } else {
            await f.target.activate(next, { previous: old });
            expect(f.target.activationRules!.map(r => r.Guid)).toEqual(old.liveRules!.map(r => r.Guid));
            expect(f.target.activationRules!.map(r => r.Description)).toEqual(['hadars:demo:dev:admin:0:0', 'hadars:demo:dev:shop:0:0']);
            next.liveRules = structuredClone(f.target.activationRules);
            await f.target.rollback(old, { previous: next });
            const restored = await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`);
            expect(restored.EdgeRules).toEqual(before.EdgeRules);
            expect(restored.EdgeScriptId).toBe(before.EdgeScriptId);
        }
    }
});

test('mock provider rejects six URL patterns on create and update with the measured 400 body', async () => {
    const f = await splitProvider(), staged = await f.target.stage(f.plan(), f.config);
    const path = `/pullzone/${f.zone.Id}/edgerules/addOrUpdate`;
    const rule = structuredClone(staged.split!.rules[0]);
    const created = await f.mock.client.request('POST', path, rule);
    rule.Triggers[0].PatternMatches = Array(6).fill('https://*/admin');
    for (const body of [rule, { ...rule, Guid: created.Guid }]) await expect(f.mock.client.request('POST', path, body)).rejects.toThrow('Bunny request failed (400): {"ErrorKey":"edgerule.invalid","Message":"Maximum 5 triggers are allowed per condition."}');
    expect((await f.mock.client.request('GET', `/pullzone/${f.zone.Id}`)).EdgeRules).toEqual([created]);
});

test('capacity includes foreign rules and disabled tombstones, before any staging side effects', async () => {
    const f = await splitProvider();
    const zone = f.mock.tables['/pullzone'].find(z => z.Id === f.zone.Id)!;
    zone.EdgeRules = Array.from({ length: 47 }, (_, i) => ({ Guid: crypto.randomUUID(), Description: `foreign-${i}`, Enabled: false }));
    const before = f.mock.managementRequests.length, published = f.mock.published.length;
    const message = 'Split rule capacity exceeded: needed 51, existing foreign 47, cap 50; reduce hostnames or mounts';
    await expect(f.target.planSplitRules(f.plan())).rejects.toThrow(message);
    await expect(f.target.stage(f.plan(), f.config)).rejects.toThrow(message);
    expect(f.mock.managementRequests.slice(before).every(r => r.method === 'GET')).toBe(true);
    expect(f.mock.published).toHaveLength(published);
    zone.EdgeRules.pop();
    zone.EdgeRules.push({ Guid: crypto.randomUUID(), Description: 'hadars:demo:dev:retired:0:0', Enabled: false });
    await expect(f.target.planSplitRules(f.plan())).rejects.toThrow('needed 51, existing foreign 46, cap 50');
});

test('mock enforces fifty-rule zone cap and still permits updates', async () => {
    const f = await splitProvider(), staged = await f.target.stage(f.plan(), f.config);
    const path = `/pullzone/${f.zone.Id}/edgerules/addOrUpdate`;
    let last: any;
    for (let i = 0; i < 50; i++) last = await f.mock.client.request('POST', path, { ...staged.split!.rules[0], Description: `foreign-${i}` });
    await expect(f.mock.client.request('POST', path, staged.split!.rules[0])).rejects.toThrow('Bunny request failed (400): {"Message":"Maximum number of edge rules reached for this zone."}');
    expect((await f.mock.client.request('POST', path, last)).Guid).toBe(last.Guid);
});

test('version-two receipts remain readable and indexed legacy rules adopt by group in native order', async () => {
    const { receipt } = await import('../../src/deploy/bunny/split-release');
    const f = await splitProvider(), stage = await f.target.stage(f.plan(), f.config);
    const zone = f.mock.tables['/pullzone'].find(z => z.Id === f.zone.Id)!;
    const historical = receipt(f.plan().splitManifest!, 'demo', 'dev', stage.split!.configDigest, stage.split!.groups, zone, 2);
    validateReceipt(historical, 'demo-dev-r1', stage);
    for (const r of historical.rules) await f.mock.client.request('POST', `/pullzone/${zone.Id}/edgerules/addOrUpdate`, r);
    const old = structuredClone(zone.EdgeRules);
    const next = await f.target.stage(f.plan(2), f.config);
    expect(next.split!.rules.map(r => r.Guid)).toEqual(old.map((r: any) => r.Guid));
    for (let i = 0; i < next.split!.rules.length; i++) {
        f.mock.armFailure(3 + i, true);
        await expect(f.target.activate(next)).rejects.toThrow('previous native state restored');
        expect(zone.EdgeRules).toEqual(old);
    }
    await f.target.activate(next);
    expect(zone.EdgeRules.map((r: any) => r.Guid)).toEqual(old.map((r: any) => r.Guid));
    expect(zone.EdgeRules.map((r: any) => r.Description)).toEqual(next.split!.rules.map(r => r.Description));
});

test('seven-host packed rule writes restore the entire state after each lost reply', async () => {
    const f = await splitProvider();
    const zone = f.mock.tables['/pullzone'].find(z => z.Id === f.zone.Id)!;
    zone.Hostnames.push(...['s1.bunny.run', 'a.example', 'b.example', 'c.example', 'd.example', 'e.example'].map(Value => ({ Value })));
    const first = await f.target.stage(f.plan(), f.config); await f.target.activate(first);
    const next = await f.target.stage(f.plan(2), f.config);
    expect(next.split!.rules).toHaveLength(12); // two descendant mounts * 4 + two exact mounts * 2
    const before = structuredClone(zone.EdgeRules);
    for (let i = 0; i < next.split!.rules.length; i++) {
        f.mock.armFailure(3 + i, true);
        await expect(f.target.activate(next, { previous: first })).rejects.toThrow('previous native state restored');
        expect(zone.EdgeRules).toEqual(before);
        expect(zone.EdgeScriptId).toBe(Number(first.scriptId));
    }
});
