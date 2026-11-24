import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Bunny } from './client';
import { BunnyTarget, type BunnyConfig } from './index';
import { setupBunny, validateProjectZones, type ProjectZones, type SetupBunnyOptions } from './zones';
import { listStaticObjects, gcCandidates, deleteStaticObjects } from './gc';
import { resolveRuntimeConfig, type RuntimeConfig } from './config';
import type { DeployStore } from './store';
function configPath(file: string) {
    const path = resolve(file);
    if (path.split('/').some(p => p.startsWith('.env'))) throw new Error('Target config cannot be an environment file');
    return path;
}
/** HADARS_BUNNY_ASSET_CONCURRENCY: parallel static transfers during staging (1-32, default 12). */
export function assetConcurrencyFrom(env: Record<string, string | undefined>): number | undefined {
    const text = env.HADARS_BUNNY_ASSET_CONCURRENCY;
    if (text === undefined || text === '') return undefined;
    if (!/^\d+$/.test(text)) throw new Error('HADARS_BUNNY_ASSET_CONCURRENCY must be an integer from 1 to 32');
    return Number(text);
}

export async function loadProjectZones(file = 'deploy.target.json'): Promise<ProjectZones> {
    let value: unknown;
    try { value = JSON.parse(await readFile(configPath(file), 'utf8')); } catch { throw new Error('Could not read deploy.target.json project zone configuration'); }
    validateProjectZones(value); return value;
}
const need = (env: Record<string, string | undefined>, name: string) => { if (!env[name]) throw new Error(`Set ${name} in the process environment`); return env[name]!; };
export async function setupProjectZones(project: string, environment: string, file: string, env: Record<string, string | undefined>, out: (line: string) => void, send: typeof fetch = fetch, options: SetupBunnyOptions = {}) {
    const dest = configPath(file);
    let old: ProjectZones | undefined;
    try { const value = JSON.parse(await readFile(dest, 'utf8')); validateProjectZones(value); old = value; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (old && old.project !== project) throw new Error('Target configuration belongs to another project');
    if (old && (old.storageZone.sharedStorage || old.storageZone.name !== `${project}-storage` || old.assetsPullZone.host !== `${project}-assets.b-cdn.net`)) throw new Error('Setup refuses adopted zones; maintain their target configuration manually');
    const result = await setupBunny(new Bunny(need(env, 'BUNNY_API_KEY'), send), project, environment, out, undefined, options);
    if (old && (old.storageZone.name !== result.storageZone.name || old.storageZone.id !== result.storageZone.id || JSON.stringify(old.assetsPullZone) !== JSON.stringify(result.assetsPullZone))) throw new Error('Existing project storage configuration differs from provider');
    if (old?.storageZone.sharedStorage !== undefined) result.storageZone.sharedStorage = old.storageZone.sharedStorage;
    result.publicZones = { ...old?.publicZones, ...result.publicZones };
    await writeFile(dest, JSON.stringify(result, null, 2) + '\n');
    out(`Saved ${file}; provide BUNNY_STORAGE_KEY through the process environment for deploy/GC`);
}
export function projectBunny(zones: ProjectZones, project: string, environment: string, env: Record<string, string | undefined>, dryRun = false, send: typeof fetch = fetch, readProvider = false) {
    if (zones.project !== project || !zones.publicZones[environment]) throw new Error('Target configuration has no public zone for this project/environment; run deploy setup bunny');
    // Offline targets fail closed even if a future planning path accidentally reads.
    const transport = (async (input, init) => {
        if (dryRun) throw new Error('Offline dry-run forbids provider requests');
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (readProvider && (method !== 'GET' || new URL(input instanceof Request ? input.url : String(input)).origin !== 'https://api.bunny.net')) throw new Error('Read-provider dry-run permits only GET management requests');
        return send(input, init);
    }) as typeof fetch;
    return new BunnyTarget({ key: dryRun ? '' : need(env, 'BUNNY_API_KEY'), storageKey: dryRun || readProvider ? '' : need(env, 'BUNNY_STORAGE_KEY'), storageZone: zones.storageZone.name, sharedStorage: zones.storageZone.sharedStorage, publicZoneId: zones.publicZones[environment].id, assetsHost: zones.assetsPullZone.host, assetConcurrency: assetConcurrencyFrom(env) }, transport);
}
export async function gcProject(o: { store: DeployStore; project: string; zones: ProjectZones; target: BunnyTarget; env: Record<string, string | undefined>; keep?: number; graceSeconds?: number; execute?: boolean; out: (line: string) => void; send?: typeof fetch }) {
    if (o.zones.project !== o.project) throw new Error('Target configuration belongs to another project');
    const graceSeconds = o.graceSeconds ?? 3600;
    if (!Number.isSafeInteger(graceSeconds) || graceSeconds < 0) throw new Error('Invalid GC grace seconds');
    const send = o.send ?? fetch, key = need(o.env, 'BUNNY_STORAGE_KEY');
    return o.store.exclusive('gc', async () => {
        const records = await o.store.listAll();
        const scripts = await o.target.scripts();
        const sharedStorage = o.zones.storageZone.sharedStorage ?? false;
        let ignoredRootObjects = 0;
        const objects = await listStaticObjects(o.zones.storageZone.name, key, send, { sharedStorage, ignoredRoot: () => ignoredRootObjects++ });
        if (sharedStorage) o.out(`Shared storage GC restricted to /_builds/ and /_shell/ only; ignored ${ignoredRootObjects} root objects; other directories excluded`);
        const now = Date.now();
        // Ignore ages for the candidate count; apply the configured grace only to eligibility.
        const unreferenced = gcCandidates(records, scripts, o.project, objects, o.keep, Infinity, 0, sharedStorage);
        const candidates = gcCandidates(records, scripts, o.project, objects, o.keep, now, graceSeconds * 1000, sharedStorage);
        // Refuse changes observed while listing. Deployment inventories are recorded before staging.
        if (JSON.stringify(await o.store.listAll()) !== JSON.stringify(records) || JSON.stringify(await o.target.scripts()) !== JSON.stringify(scripts)) throw new Error('Deployments changed during GC; retry');
        for (const path of candidates) o.out(`${o.execute ? 'Delete' : 'Would delete'} /${path}`);
        await deleteStaticObjects(o.zones.storageZone.name, key, candidates, send, o.execute, sharedStorage);
        o.out(`${o.execute ? 'Deleted' : 'Dry-run:'} ${candidates.length} objects; all environments/previews protected; grace ${graceSeconds} seconds; ${unreferenced.length} candidates, ${candidates.length} eligible`);
        return { candidates: unreferenced, eligible: candidates };
    });
}

/** Only this cwd default is considered; JSON parse errors never echo file contents. */
export async function loadDeployConfig(file?: string, overrides: string[] = [], cwd = process.cwd(), env: Record<string, string | undefined> = process.env): Promise<RuntimeConfig | undefined> {
    const path = resolve(cwd, file ?? 'deploy.config.json');
    // Runtime config must never become an alternate dotenv/credential-file loader.
    if (path.split('/').some(part => part.startsWith('.env'))) throw new Error('Deploy config cannot be an environment file');
    let source: string;
    try { source = await readFile(path, 'utf8'); }
    catch (error) {
        if (!file && (error as NodeJS.ErrnoException).code === 'ENOENT') return overrides.length ? resolveRuntimeConfig({}, overrides, env) : undefined;
        throw new Error('Could not read deploy configuration JSON file');
    }
    let input: unknown;
    try { input = JSON.parse(source); } catch { throw new Error('Invalid deploy configuration JSON'); }
    return resolveRuntimeConfig(input, overrides, env);
}
