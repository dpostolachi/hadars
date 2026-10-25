import { createHash } from 'node:crypto';
import type { BuildManifest } from './artifacts';

export const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const sorted = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));

/** v1 identity: property order and optional metadata are part of the contract. */
export function computeBuildId(m: Omit<BuildManifest, 'buildId'>): string {
    const identity = {
        ...(m.types?.length ? { types: [...m.types].sort() } : {}),
        ...(m.typeApi ? { typeApi: { declarationsSha256: m.typeApi.declarationsSha256,
            exports: Object.fromEntries(Object.entries(m.typeApi.exports).sort().map(([ns, exports]) => [ns, Object.fromEntries(Object.entries(exports as object).sort())])) } } : {}),
        kind: m.kind, name: m.name, runtimeContract: m.runtimeContract, flavour: m.flavour,
        targets: { client: { js: m.targets.client.js, css: m.targets.client.css }, server: { js: m.targets.server.js, css: m.targets.server.css } },
        exposes: [...m.exposes].sort(), shared: [...m.shared].sort(), provides: m.runtimeContract === '2' ? sorted(m.provides as Record<string, string>) : [...(m.provides as string[])].sort(), requires: sorted(m.requires),
        files: [...m.files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })),
    };
    return hash(JSON.stringify(identity)).slice(0, 16);
}
