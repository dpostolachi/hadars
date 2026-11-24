import type { BuildManifest } from './identity';
import type { LinkedFile } from './index';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Native metadata describes files actually consumed by the linker, not every server-side auxiliary file. */
export function linkedModuleErrors(name: string, value: unknown, manifest: BuildManifest): string[] {
    const errors: string[] = [], prefix = `linked module ${name}`;
    if (!record(value)) return [`${prefix}: missing or invalid metadata`];
    if (value.buildId !== manifest.buildId) errors.push(`${prefix} buildId: expected ${manifest.buildId}, got ${String(value.buildId)}`);
    if (value.clientOnly !== !!manifest.clientOnly) errors.push(`${prefix} clientOnly: expected ${!!manifest.clientOnly}, got ${String(value.clientOnly)}`);
    for (const key of ['server', 'client'] as const) {
        const files = value[key];
        if (!Array.isArray(files)) { errors.push(`${prefix} ${key}: expected file list`); continue; }
        const seen = new Set<string>();
        for (const f of files) {
            if (!record(f) || typeof f.path !== 'string') { errors.push(`${prefix} ${key}: invalid file metadata`); continue; }
            if (seen.has(f.path)) errors.push(`${prefix} ${key}/${f.path}: duplicate file`);
            seen.add(f.path);
            const pin = manifest.files.find(p => p.path === f.path);
            if (!pin) errors.push(`${prefix} ${key}/${f.path}: absent from pinned build`);
            else {
                if (f.size !== pin.size) errors.push(`${prefix} ${key}/${f.path} size: expected ${pin.size}, got ${String(f.size)}`);
                if (f.sha256 !== pin.sha256) errors.push(`${prefix} ${key}/${f.path} sha256: expected ${pin.sha256}, got ${String(f.sha256)}`);
            }
            if (key === 'server' && (manifest.clientOnly || moduleClients(manifest).some(p => p.path === f.path) || f.path.endsWith('.d.ts'))) errors.push(`${prefix} server/${f.path}: not a linked server input`);
        }
        const required = key === 'client' ? moduleClients(manifest).map(f => f.path) : manifest.clientOnly ? [] : manifest.targets.server.js;
        if (key === 'server' && !manifest.clientOnly && !required.length) errors.push(`${prefix}: no pinned server entry; clientOnly must be explicit`);
        for (const path of required) if (!seen.has(path)) errors.push(`${prefix} ${key}/${path}: missing file`);
        if (key === 'client') for (const path of seen) if (!required.includes(path)) errors.push(`${prefix} client/${path}: unexpected file`);
    }
    return errors;
}
export function moduleClients(manifest: BuildManifest): LinkedFile[] {
    const server = new Set([...manifest.targets.server.js, ...manifest.targets.server.css]);
    const client = new Set([...manifest.targets.client.js, ...manifest.targets.client.css]);
    return manifest.files.filter(f => !server.has(f.path) && !f.path.endsWith('.d.ts') && (f.path.startsWith('client/') || client.has(f.path)));
}
