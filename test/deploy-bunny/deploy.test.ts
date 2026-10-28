import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitProvider } from './helpers/split';
import { deployEnvironment, fileStore, deployCommand, gcCandidates } from '../../src/deploy/bunny/entry';

const state = () => join(mkdtempSync(join(tmpdir(), 'deploy-state-')), 'state.json');

test('file store supersedes the previous live record and keeps newest revision first', async () => {
    const store = fileStore(state());
    const base = { environment: 'dev', target: 'bunny' as const, artifactSummary: { files: 1, bytes: 1 } };
    await store.record({ ...base, id: 'a', revision: 1, status: 'live' });
    await store.record({ ...base, id: 'b', revision: 2, status: 'pending' });
    await store.record({ ...base, id: 'b', revision: 2, status: 'live' });
    const records = await store.list('dev');
    expect(records.map(r => [r.id, r.status])).toEqual([['b', 'live'], ['a', 'superseded']]);
    expect(records[0]!.previousDeploymentId).toBe('a');
    await store.record({ ...base, id: 'a2', revision: 1, status: 'live', rollbackOf: 'a' });
    expect((await store.list('dev')).find(r => r.id === 'b')!.status).toBe('rolled_back');
});

test('file store lock is exclusive and released after the work', async () => {
    const store = fileStore(state());
    await expect(store.exclusive('dev', async () => store.exclusive('dev', async () => 1))).rejects.toThrow('Another deploy holds dev');
    expect(await store.exclusive('dev', async () => 'ok')).toBe('ok');
});

test('deploy, redeploy a revision as a no-op, deploy again, then roll back', async () => {
    const f = await splitProvider();
    const store = fileStore(state()), lines: string[] = [];
    const run = (extra: object = {}) => deployEnvironment({ store, project: 'demo', environment: 'dev', target: f.target, artifact: f.fixture.artifact, config: f.config, probeTimeoutSeconds: 5, out: l => lines.push(l), ...extra });
    await run({ dryRun: true });
    expect((await store.list('dev'))).toEqual([]);
    expect(lines.some(l => l.startsWith('Plan dev revision 1'))).toBe(true);

    await run();
    expect((await store.list('dev')).map(r => [r.revision, r.status])).toEqual([[1, 'live']]);
    lines.length = 0;
    await run({ revision: 1 });
    expect(lines.some(l => l.startsWith('No-op: dev revision 1 already live'))).toBe(true);
    expect((await store.list('dev'))).toHaveLength(1);

    await run();
    expect((await store.list('dev')).map(r => [r.revision, r.status])).toEqual([[2, 'live'], [1, 'superseded']]);

    await deployEnvironment({ store, project: 'demo', environment: 'dev', target: f.target, rollback: true, probeTimeoutSeconds: 5, out: () => {} });
    const after = await store.list('dev');
    expect(after.find(r => r.status === 'live')!.revision).toBe(1);
    expect(after.find(r => r.revision === 2)!.status).toBe('rolled_back');
});

test('a failed stage is recorded as failed and the lock is released', async () => {
    const f = await splitProvider();
    const store = fileStore(state());
    f.mock.armFailure(6); // past planning, inside staging
    await expect(deployEnvironment({ store, project: 'demo', environment: 'dev', target: f.target, artifact: f.fixture.artifact, config: f.config, probeTimeoutSeconds: 5, out: () => {} })).rejects.toThrow();
    expect((await store.list('dev')).map(r => r.status)).toEqual(['failed']);
    expect(await store.exclusive('dev', async () => 'free')).toBe('free');
});

test('rollback with nothing to return to is refused', async () => {
    const f = await splitProvider();
    await expect(deployEnvironment({ store: fileStore(state()), project: 'demo', environment: 'dev', target: f.target, rollback: true, out: () => {} })).rejects.toThrow('No previous live deployment');
});

test('deploy command validates its arguments before any provider call', async () => {
    const errors: string[] = [];
    const run = (args: string[]) => deployCommand(args, { env: {}, out: () => {}, err: l => errors.push(l), send: (async () => { throw new Error('no network'); }) as typeof fetch });
    expect(await run([])).toBe(2);
    expect(await run(['nonsense'])).toBe(1);
    expect(await run(['setup'])).toBe(1);
    expect(errors.at(-1)).toContain('Use hadars deploy setup');
    const dir = mkdtempSync(join(tmpdir(), 'deploy-target-'));
    const zones = join(dir, 'deploy.target.json');
    await Bun.write(zones, JSON.stringify({ version: 1, project: 'demo', storageZone: { name: 'demo-storage', id: '1' }, assetsPullZone: { id: '2', host: 'demo-assets.b-cdn.net' }, publicZones: { dev: { id: '3', name: 'demo-dev' } } }));
    expect(await run(['bunny', dir, '--target-config', zones])).toBe(1);
    expect(errors.at(-1)).toContain('--env');
    expect(await run(['bunny', dir, '--env', 'dev', '--read-provider', '--target-config', zones])).toBe(1);
    expect(errors.at(-1)).toContain('--read-provider requires --dry-run');
    expect(await run(['rollback', '--env', 'dev', '--config', 'x.json', '--target-config', zones])).toBe(1);
    expect(errors.at(-1)).toContain('Rollback uses the original');
});

test('gc protection works from file-store records', async () => {
    const store = fileStore(state());
    await store.record({ id: 'a', environment: 'dev', revision: 1, target: 'bunny', status: 'live', artifactSummary: { files: 1, bytes: 1 }, staticPaths: ['_builds/aaaaaaaaaaaaaaaa/client/x.js'] });
    const records = await store.listAll();
    const objects = [{ path: '_builds/aaaaaaaaaaaaaaaa/client/x.js', lastChanged: 0 }, { path: '_builds/bbbbbbbbbbbbbbbb/client/y.js', lastChanged: 0 }];
    expect(gcCandidates(records, [], 'demo', objects, 5, 10_000, 0)).toEqual(['_builds/bbbbbbbbbbbbbbbb/client/y.js']);
});
