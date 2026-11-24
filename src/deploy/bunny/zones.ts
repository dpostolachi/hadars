import type { BunnyClient } from './index';
export interface ProjectZones {
    version: 1;
    project: string;
    storageZone: { name: string; id: string; sharedStorage?: boolean };
    assetsPullZone: { id: string; host: string };
    publicZones: Record<string, { id: string; name: string }>;
}
const nameOK = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]+$/.test(v);
const idOK = (v: unknown) => typeof v === 'string' && /^\d+$/.test(v);
export const dnsHostname = (v: unknown): v is string => typeof v === 'string' && v.length <= 253 && v.includes('.') && v.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
export function validateProjectZones(v: any): asserts v is ProjectZones {
    if (!v || v.version !== 1 || !nameOK(v.project) || !nameOK(v.storageZone?.name) || !idOK(v.storageZone?.id) || !idOK(v.assetsPullZone?.id) || !dnsHostname(v.assetsPullZone?.host) || !v.publicZones || typeof v.publicZones !== 'object' || Array.isArray(v.publicZones) || Object.values(v.publicZones).some((z: any) => !idOK(z?.id) || !nameOK(z?.name)) || Object.keys(v).some(k => !['version', 'project', 'storageZone', 'assetsPullZone', 'publicZones'].includes(k)) || Object.keys(v.storageZone).some(k => !['id','name','sharedStorage'].includes(k)) || (v.storageZone.sharedStorage !== undefined && typeof v.storageZone.sharedStorage !== 'boolean') || Object.keys(v.assetsPullZone).some(k => !['id','host'].includes(k)) || Object.entries(v.publicZones).some(([env,z]: [string, any]) => !nameOK(env) || Object.keys(z).some(k => !['id','name'].includes(k)))) throw new Error('Invalid deploy.target.json (non-secret project zones only)');
}
function complete(value: any): any[] {
    const items = Array.isArray(value) ? value : value?.Items;
    if (!Array.isArray(items) || value.HasMore || value.TotalItems > items.length) throw new Error('Incomplete provider list; refusing setup');
    return items;
}
const publicZoneSettings = {
    EnableSmartCache: true,
    IgnoreQueryStrings: false,
    DisableCookies: false,
    AddHostHeader: true,
} as const;
export interface SetupBunnyOptions { fixPublicZoneSettings?: boolean }
export function settingsDrift(zone: any): string[] {
    return Object.entries(publicZoneSettings).filter(([key, expected]) => zone?.[key] !== expected)
        .map(([key, expected]) => `${key}: expected=${expected}, actual=${String(zone?.[key])}`);
}
/** Existing zones are read-only unless explicitly repairing public settings; never resets a pointer or deletes. */
export async function setupBunny(client: BunnyClient, project: string, environment: string, out: (line: string) => void, names = { storage: `${project}-storage`, assets: `${project}-assets`, public: `${project}-${environment}`, placeholder: `${project}-${environment}-placeholder` }, options: SetupBunnyOptions = {}): Promise<ProjectZones> {
    if (![project, environment, ...Object.values(names)].every(nameOK)) throw new Error('Invalid project/zone name');
    const find = async (path: string, name: string) => {
        const matches = complete(await client.request('GET', path)).filter(z => z.Name === name);
        if (matches.length > 1) throw new Error('Ambiguous provider zone name');
        if (matches[0]) out(`Found ${path} ${name} (${matches[0].Id})`);
        return matches[0];
    };
    const create = async (path: string, body: any) => {
        const row = await client.request('POST', path, body);
        if (!/^\d+$/.test(String(row?.Id))) throw new Error('Invalid provider resource ID');
        out(`Created ${path} ${body.Name} (${row.Id})`); return row;
    };
    const storage = await find('/storagezone', names.storage) ?? await create('/storagezone', { Name: names.storage, Region: 'DE' });
    const origin = `https://storage.bunnycdn.com/${names.storage}`;
    const assets = await find('/pullzone', names.assets) ?? await create('/pullzone', { Name: names.assets, StorageZoneId: storage.Id, OriginUrl: origin });
    // Bunny stores a storage-backed pull zone as OriginType 2 with the StorageZoneId and an empty OriginUrl (it does not keep the URL
    // sent at creation), so identity is the storage zone id; tolerate providers/mocks that echo the origin URL.
    if (Number(assets.StorageZoneId) !== Number(storage.Id) || (assets.OriginType !== undefined && assets.OriginType !== 2 && assets.OriginUrl !== origin)) throw new Error('Existing assets zone has a different storage origin');
    let pub = await find('/pullzone', names.public);
    if (pub && pub.OriginType !== 4) throw new Error('Existing public zone is not an EdgeScript origin');
    const isNewPublic = !pub;
    if (!pub) {
        let placeholder = await find('/compute/script', names.placeholder);
        if (!placeholder) {
            placeholder = await create('/compute/script', { Name: names.placeholder, ScriptType: 1, CreateLinkedPullZone: false });
        }
        // Retry publication if an earlier setup stopped after script creation.
        await client.publish(String(placeholder.Id), `import * as BunnySDK from '@bunny.net/edgescript-sdk'; BunnySDK.net.http.serve(() => new Response('placeholder', {headers:{'cache-control':'no-store'}}));`);
        pub = await create('/pullzone', { Name: names.public, OriginType: 4, OriginUrl: 'https://bunnycdn.com', EdgeScriptId: placeholder.Id });
    }
    const publicPath = `/pullzone/${pub.Id}`;
    const drift = settingsDrift(await client.request('GET', publicPath));
    if (!isNewPublic && drift.length) {
        for (const line of drift) out(`Public zone ${names.public} drift: ${line}`);
        if (!options.fixPublicZoneSettings) throw new Error('Public zone settings drift; rerun with --fix-public-zone-settings to repair');
    }
    if (isNewPublic || (drift.length && options.fixPublicZoneSettings)) {
        await client.request('POST', publicPath, { ...publicZoneSettings });
        const remaining = settingsDrift(await client.request('GET', publicPath));
        if (remaining.length) throw new Error(`Public zone settings verification failed: ${remaining.join('; ')}`);
    }
    const result: ProjectZones = { version: 1, project, storageZone: { name: names.storage, id: String(storage.Id) }, assetsPullZone: { id: String(assets.Id), host: `${names.assets}.b-cdn.net` }, publicZones: { [environment]: { id: String(pub.Id), name: names.public } } };
    validateProjectZones(result); return result;
}
