import { managedStaticPath, safeStaticPath } from './layout';
import { storage } from './client';
/** What GC needs to know about a past deployment. The caller (a state file, or a service that tracks deployments) supplies these;
 * the provider never imports a store, so it can run with either. */
export interface GcRecord {
    id: string; environment: string; revision: number; startedAt: number;
    status: string;
    staged?: { scriptId: string; split?: { groups: Array<{ scriptId: string }> } };
    staticPaths?: string[]; previousDeploymentId?: string;
}
const ownedPrefix = (path: string) => path.startsWith('_builds/') || path.startsWith('_shell/');
export interface StorageObject { path: string; lastChanged: number }
/** Directory arrays are the Bunny storage listing contract. No invented page-number protocol:
 * each directory is a separate GET; incomplete/paginated envelopes fail closed. */
export async function listStaticObjects(zone: string, key: string, send: typeof fetch, options: { sharedStorage?: boolean; ignoredRoot?: () => void } = {}): Promise<StorageObject[]> {
    if (!/^[a-z0-9-]+$/.test(zone)) throw new Error('Invalid storage zone');
    const objects: StorageObject[] = [], visited = new Set<string>();
    async function walk(directory: string) {
        if (visited.has(directory)) throw new Error('Repeated storage directory');
        visited.add(directory);
        const response = await send(`https://storage.bunnycdn.com/${zone}/${directory.split('/').filter(Boolean).map(encodeURIComponent).join('/')}${directory ? '/' : ''}`, { headers: { AccessKey: key }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`Storage listing failed (${response.status})`);
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error('Incomplete storage listing');
        const seen = new Set<string>();
        for (const row of rows) {
            if (!row || !safeStaticPath(row.ObjectName) || row.ObjectName.includes('/') || seen.has(row.ObjectName) || typeof row.IsDirectory !== 'boolean') throw new Error('Invalid storage listing entry');
            seen.add(row.ObjectName);
            const path = directory + row.ObjectName;
            if (row.IsDirectory) {
                // Shared storage reserves only owned prefixes; exclusive storage also collects hashed discovery files.
                if (directory || (options.sharedStorage ? ['_builds', '_shell'] : ['_builds', '_shell', 'discovery']).includes(row.ObjectName)) await walk(path + '/');
            } else if (options.sharedStorage && !directory) {
                options.ignoredRoot?.();
            } else if (managedStaticPath(path)) {
                const date = row.LastChanged;
                // Bunny's timestamps may omit the UTC suffix; storage timestamps are UTC.
                const lastChanged = typeof date === 'string' ? Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(date) ? date : date + 'Z') : NaN;
                if (!Number.isFinite(lastChanged)) throw new Error('Invalid storage object timestamp');
                objects.push({ path, lastChanged });
            }
        }
    }
    await walk(''); return objects;
}
export function gcCandidates(records: GcRecord[], scripts: Array<{ Id: number; Name: string }>, project: string, objects: StorageObject[], keep = 5, now = Date.now(), graceMs = 3_600_000, sharedStorage = false): string[] {
    if (!Number.isSafeInteger(keep) || keep < 0 || !Number.isFinite(graceMs) || graceMs < 0) throw new Error('Invalid GC retention/grace');
    if (objects.some(o => !managedStaticPath(o.path))) throw new Error('GC refuses unknown storage prefixes');
    const retained = new Set<GcRecord>();
    const scriptIds = new Set(scripts.map(s => String(s.Id)));
    for (const env of new Set(records.map(r => r.environment))) {
        const scoped = records.filter(r => r.environment === env).sort((a,b) => b.revision - a.revision || b.startedAt - a.startedAt);
        const revisions = [...new Set(scoped.map(r => r.revision))].slice(0, keep);
        for (const r of scoped) if (revisions.includes(r.revision) || ['live','pending','staged','verifying'].includes(r.status) || r.staged && (scriptIds.has(r.staged.scriptId) || r.staged.split?.groups.some(g => scriptIds.has(g.scriptId)))) retained.add(r);
        for (const r of scoped.filter(r => r.status === 'live')) {
            const previous = records.find(p => p.id === r.previousDeploymentId);
            if (r.previousDeploymentId && !previous) throw new Error('Missing previous deployment record; GC refused');
            if (previous) retained.add(previous);
        }
    }
    for (const script of scripts.filter(s => s.Name.startsWith(project + '-') && /-r\d+(?:-c[1-9]\d*)?$/.test(s.Name))) {
        if (!records.some(r => r.staged?.scriptId === String(script.Id))) throw new Error('Unrecorded project script; GC refused');
    }
    const referenced = new Set<string>();
    for (const r of retained) {
        if (!r.staticPaths) throw new Error('Retained legacy deployment has no static inventory; GC refused');
        for (const path of r.staticPaths) {
            if (!managedStaticPath(path)) throw new Error('Invalid retained static inventory; GC refused');
            referenced.add(path);
        }
    }
    return objects.filter(o => (!sharedStorage || ownedPrefix(o.path)) && !referenced.has(o.path) && Number.isFinite(o.lastChanged) && o.lastChanged < now - graceMs).map(o => o.path).sort();
}
export async function deleteStaticObjects(zone: string, key: string, paths: string[], send: typeof fetch, execute = false, sharedStorage = false) {
    if (paths.some(p => !managedStaticPath(p) || sharedStorage && !ownedPrefix(p))) throw new Error('GC refuses unknown storage prefixes');
    if (execute) for (const path of paths) await storage('DELETE', zone, key, path, undefined, send);
}
