import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { BunnyTarget, type Artifact } from '../../src/deploy/bunny';
import { mockProvider } from './helpers/mockProvider';
import { assetConcurrencyFrom } from '../../src/deploy/bunny/target';

const bytes = (s: string) => new TextEncoder().encode(s);
const sha = (s: string) => createHash('sha256').update(bytes(s)).digest('hex');
const files = (n: number, body = 'v1') => Array.from({ length: n }, (_, i) => ({ path: `chunk.abcdef${10 + i}.js`, bytes: bytes(`${body}-${i}`) }));

test('a file the live release holds (same path and hash) is not looked up or uploaded again', async () => {
    const mock = mockProvider();
    const target = new BunnyTarget({ key: 'mock', storageKey: 'mock', storageZone: 'demo', publicZoneId: '1', sharedStorage: true }, mock.send, mock.client);
    target.setKnownStatic({ 'chunk.abcdef10.js': sha('v1-0') });
    const artifact: Artifact = { entry: 'bunny.mjs', files: [{ path: 'bunny.mjs', bytes: bytes('script') }, ...files(2)] };
    await target.stage(target.plan({ project: 'demo', environment: 'dev', revision: 1, artifact }));
    expect(mock.storageRequests.filter(r => r.url.endsWith('/chunk.abcdef10.js'))).toHaveLength(0);
    expect(mock.storageRequests.filter(r => r.url.endsWith('/chunk.abcdef11.js') && r.method === 'GET')).toHaveLength(2);
});

test('same path with a different hash is still looked up, never skipped', async () => {
    const mock = mockProvider();
    mock.objects.set('/demo/app.abcdef12.js', bytes('old-content'));
    const target = new BunnyTarget({ key: 'mock', storageKey: 'mock', storageZone: 'demo', publicZoneId: '1', sharedStorage: true }, mock.send, mock.client);
    target.setKnownStatic({ 'app.abcdef12.js': sha('old-content') });
    const artifact: Artifact = { entry: 'bunny.mjs', files: [{ path: 'bunny.mjs', bytes: bytes('script') }, { path: 'app.abcdef12.js', bytes: bytes('new-content') }] };
    await expect(target.stage(target.plan({ project: 'demo', environment: 'dev', revision: 1, artifact }))).rejects.toThrow('collision');
    expect(mock.storageRequests.some(r => r.url.endsWith('/app.abcdef12.js') && r.method === 'GET')).toBe(true);
});

test('configured concurrency caps the number of static transfers in flight', async () => {
    let inFlight = 0, peak = 0;
    const mock = mockProvider();
    const send = (async (input: any, init?: any) => {
        const method = init?.method ?? 'GET';
        if (method === 'PUT' || method === 'GET') { inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, 5)); inFlight--; }
        return mock.send(input, init);
    }) as typeof fetch;
    const target = new BunnyTarget({ key: 'mock', storageKey: 'mock', storageZone: 'demo', publicZoneId: '1', sharedStorage: true, assetConcurrency: 3 }, send, mock.client);
    const artifact: Artifact = { entry: 'bunny.mjs', files: [{ path: 'bunny.mjs', bytes: bytes('script') }, ...files(20)] };
    await target.stage(target.plan({ project: 'demo', environment: 'dev', revision: 1, artifact }));
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
});

test('concurrency and its environment setting are validated', () => {
    const mock = mockProvider();
    expect(() => new BunnyTarget({ key: 'k', storageKey: 'k', storageZone: 'demo', publicZoneId: '1', assetConcurrency: 0 }, mock.send, mock.client)).toThrow('Asset concurrency');
    expect(() => new BunnyTarget({ key: 'k', storageKey: 'k', storageZone: 'demo', publicZoneId: '1', assetConcurrency: 33 }, mock.send, mock.client)).toThrow('Asset concurrency');
    expect(assetConcurrencyFrom({})).toBeUndefined();
    expect(assetConcurrencyFrom({ HADARS_BUNNY_ASSET_CONCURRENCY: '8' })).toBe(8);
    expect(() => assetConcurrencyFrom({ HADARS_BUNNY_ASSET_CONCURRENCY: '8x' })).toThrow('HADARS_BUNNY_ASSET_CONCURRENCY');
});
