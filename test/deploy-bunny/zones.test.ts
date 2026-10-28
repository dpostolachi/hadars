import { expect, test } from 'bun:test';
import { setupBunny, type BunnyClient } from '../../src/deploy/bunny';
import { mockProvider } from './helpers/mockProvider';

const expected = { EnableSmartCache: true, IgnoreQueryStrings: false, DisableCookies: false, AddHostHeader: true };
const defaults = { EnableSmartCache: false, IgnoreQueryStrings: true, DisableCookies: true, AddHostHeader: false };

test('public setup applies four settings via POST and verifies GET; assets keep provider defaults', async () => {
    const mock = mockProvider(), writes: any[] = [], reads: string[] = [];
    const client: BunnyClient = { ...mock.client, async request(method, path, body) {
        if (method === 'POST' && /^\/pullzone\/\d+$/.test(path)) writes.push({ path, body: structuredClone(body) });
        if (method === 'GET') reads.push(path);
        return mock.client.request(method, path, body);
    } };
    const zones = await setupBunny(client, 'demo', 'dev', () => {});
    const path = `/pullzone/${zones.publicZones.dev.id}`;
    expect(writes).toEqual([{ path, body: expected }]);
    expect(reads.filter(p => p === path).length).toBeGreaterThanOrEqual(1);
    expect(mock.calls.at(-1)).toBe(`GET ${path}`);
    expect(await mock.client.request('GET', path)).toMatchObject(expected);
    expect(await mock.client.request('GET', `/pullzone/${zones.assetsPullZone.id}`)).toMatchObject(defaults);
    const before = mock.calls.length;
    expect(await setupBunny(client, 'demo', 'dev', () => {})).toEqual(zones);
    expect(mock.calls.slice(before).every(c => c.startsWith('GET'))).toBe(true);
});

test('existing public drift reports every expected/actual value without any mutation; explicit repair preserves other fields', async () => {
    const mock = mockProvider();
    const zones = await setupBunny(mock.client, 'demo', 'dev', () => {});
    const pub = mock.tables['/pullzone'].find(z => String(z.Id) === zones.publicZones.dev.id)!;
    Object.assign(pub, defaults, { EdgeScriptId: 987, CustomSetting: 'keep' });
    const snapshot = structuredClone(mock.tables), lines: string[] = [], before = mock.calls.length;
    await expect(setupBunny(mock.client, 'demo', 'dev', s => lines.push(s))).rejects.toThrow('--fix-public-zone-settings');
    expect(mock.tables).toEqual(snapshot);
    expect(mock.calls.slice(before).every(c => c.startsWith('GET'))).toBe(true);
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
        expect(lines).toContain(`Public zone demo-dev drift: ${key}: expected=${expected[key]}, actual=${defaults[key]}`);
    }
    const writes: any[] = [];
    const client: BunnyClient = { ...mock.client, async request(method, path, body) {
        if (method !== 'GET') writes.push({ method, path, body: structuredClone(body) });
        return mock.client.request(method, path, body);
    } };
    await setupBunny(client, 'demo', 'dev', () => {}, undefined, { fixPublicZoneSettings: true });
    expect(writes).toEqual([{ method: 'POST', path: `/pullzone/${pub.Id}`, body: expected }]);
    expect(pub).toEqual({ ...snapshot['/pullzone'].find(z => z.Id === pub.Id)!, ...expected });
    expect(mock.tables['/pullzone'].find(z => String(z.Id) === zones.assetsPullZone.id)).toEqual(snapshot['/pullzone'].find(z => String(z.Id) === zones.assetsPullZone.id));
    writes.length = 0;
    await setupBunny(client, 'demo', 'dev', () => {}, undefined, { fixPublicZoneSettings: true });
    expect(writes).toEqual([]);
});

for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    for (const repair of [false, true]) test(`${repair ? 'repair' : 'creation'} fails if provider ignores ${key} despite successful POST`, async () => {
        const mock = mockProvider();
        if (repair) {
            const zones = await setupBunny(mock.client, 'demo', 'dev', () => {});
            Object.assign(mock.tables['/pullzone'].find(z => String(z.Id) === zones.publicZones.dev.id)!, defaults);
        }
        const client: BunnyClient = { ...mock.client, async request(method, path, body: any) {
            if (method === 'POST' && /^\/pullzone\/\d+$/.test(path)) {
                const applied = { ...body }; delete applied[key];
                await mock.client.request(method, path, applied);
                // A successful response echo is not proof that settings were stored.
                return body;
            }
            return mock.client.request(method, path, body);
        } };
        await expect(setupBunny(client, 'demo', 'dev', () => {}, undefined, { fixPublicZoneSettings: repair })).rejects.toThrow(`${key}: expected=${expected[key]}, actual=${defaults[key]}`);
    });
}

test('missing setting is drift and a non-EdgeScript zone cannot be repaired', async () => {
    const mock = mockProvider(), zones = await setupBunny(mock.client, 'demo', 'dev', () => {});
    const pub = mock.tables['/pullzone'].find(z => String(z.Id) === zones.publicZones.dev.id)!;
    delete pub.AddHostHeader;
    const lines: string[] = [];
    await expect(setupBunny(mock.client, 'demo', 'dev', s => lines.push(s))).rejects.toThrow('drift');
    expect(lines.join('\n')).toContain('AddHostHeader: expected=true, actual=undefined');
    pub.OriginType = 2;
    const before = mock.calls.length;
    await expect(setupBunny(mock.client, 'demo', 'dev', () => {}, undefined, { fixPublicZoneSettings: true })).rejects.toThrow('not an EdgeScript');
    expect(mock.calls.slice(before).every(c => c.startsWith('GET'))).toBe(true);
});

test('target accepts lowercase DNS assets hosts and an optional boolean sharedStorage', async () => {
    const { validateProjectZones } = await import('../../src/deploy/bunny');
    const zones = { version: 1, project: 'demo', storageZone: { name: 'adopted', id: '1703873' }, assetsPullZone: { id: '6250211', host: 'static.example.com' }, publicZones: {} };
    for (const host of ['static.example.com', 'demo-assets.b-cdn.net', 'a.b', 'a-1.example', `${'a'.repeat(63)}.net`]) {
        expect(() => validateProjectZones({ ...zones, assetsPullZone: { ...zones.assetsPullZone, host } })).not.toThrow();
    }
    for (const host of ['LOCAL.example', 'localhost', '-bad.example', 'bad-.example', 'a..net', '.net', 'a.net.', 'https://a.net', 'a.net/path', 'a.net:443', 'user@a.net', 'a_net.net', '', null, 123, `${'a'.repeat(64)}.net`, `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`]) {
        expect(() => validateProjectZones({ ...zones, assetsPullZone: { ...zones.assetsPullZone, host } })).toThrow('Invalid deploy.target.json');
    }
    for (const sharedStorage of [true, false]) expect(() => validateProjectZones({ ...zones, storageZone: { ...zones.storageZone, sharedStorage } })).not.toThrow();
    for (const sharedStorage of ['true', 1, null, {}]) expect(() => validateProjectZones({ ...zones, storageZone: { ...zones.storageZone, sharedStorage } })).toThrow();
    expect(() => validateProjectZones(zones)).not.toThrow();
});
