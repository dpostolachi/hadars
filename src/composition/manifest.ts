import type { CompositionOptions } from '../types/hadars';

/**
 * What a module declares about itself in `hadars.manifest.ts`. The build, the
 * routing plan and typed access from a shell or another module all derive from it.
 * @experimental
 */
export interface HadarsManifest {
    /** Unique module name; also the key the client bundle registers under. */
    name: string;
    /** Namespace name -> source file, relative to the manifest. Everything another package may use. */
    exposes: Record<string, string>;
    /** Extra packages the host provides, beyond React and its JSX runtimes. */
    shared?: string[];
    /** Shared package version ranges required from the pinned shell. */
    requires?: Record<string, string>;
    /** Skip server linking; this module renders only in the browser. */
    clientOnly?: boolean;
    /** URL patterns this module owns (`/admin`, `/admin/**`). Feeds the split routing plan. */
    mounts?: string[];
    /** Name of the `exposes` entry that holds the module's route table. */
    routes?: string;
    /** Other modules this one embeds as components; resolved through the shell, never imported directly. */
    uses?: string[];
}

export const MANIFEST_FILES = ['hadars.manifest.ts', 'hadars.manifest.mts', 'hadars.manifest.js', 'hadars.manifest.mjs'];

const MODULE_NAME = /^[A-Za-z0-9][\w-]*$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const MOUNT = /^(?:\/|\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*(?:\/\*\*)?)$/;

/** Identity helper that gives `hadars.manifest.ts` type checking and completion. */
export function defineManifest<const T extends HadarsManifest>(manifest: T): T {
    return manifest;
}

const unique = (values: string[]) => new Set(values).size === values.length;

/** Throws a message naming the manifest and the offending field. */
export function validateManifest(m: HadarsManifest): void {
    const bad = (why: string): never => { throw new Error(`Invalid hadars manifest "${m?.name}": ${why}`); };
    if (!m || typeof m !== 'object') throw new Error('Invalid hadars manifest: expected an object');
    if (typeof m.name !== 'string' || !MODULE_NAME.test(m.name)) bad('name must use letters, digits, "_" and "-"');
    const keys = Object.keys(m.exposes ?? {});
    if (!keys.length) bad('exposes nothing');
    for (const key of keys) {
        if (!IDENT.test(key)) bad(`exposes key "${key}" must be a valid JavaScript identifier`);
        if (typeof m.exposes[key] !== 'string' || !m.exposes[key]) bad(`exposes "${key}" needs a source file`);
    }
    if (m.mounts !== undefined) {
        if (!Array.isArray(m.mounts) || !m.mounts.length || !unique(m.mounts)) bad('mounts must be a nonempty list without duplicates');
        for (const mount of m.mounts) if (typeof mount !== 'string' || !MOUNT.test(mount)) bad(`mount ${JSON.stringify(mount)} must be "/" or a literal path, optionally ending in "/**"`);
    }
    if (m.routes !== undefined && !keys.includes(m.routes)) bad(`routes "${m.routes}" is not an exposes entry`);
    if (m.routes !== undefined && !m.mounts) bad('routes need mounts: a route table belongs to the paths the module owns');
    if (m.uses !== undefined) {
        if (!Array.isArray(m.uses) || !unique(m.uses)) bad('uses must be a list of module names without duplicates');
        for (const use of m.uses) {
            if (typeof use !== 'string' || !MODULE_NAME.test(use)) bad(`uses entry ${JSON.stringify(use)} is not a module name`);
            if (use === m.name) bad('a module cannot use itself');
        }
    }
    if (m.clientOnly !== undefined && typeof m.clientOnly !== 'boolean') bad('clientOnly must be a boolean');
}

/** Rejects `uses` cycles and unknown names across a set of manifests; returns names in dependency order. */
export function orderManifests(manifests: HadarsManifest[]): string[] {
    const byName = new Map(manifests.map((m) => [m.name, m]));
    if (byName.size !== manifests.length) throw new Error('Duplicate module name across hadars manifests');
    const order: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (name: string, trail: string[]) => {
        if (state.get(name) === 'done') return;
        if (state.get(name) === 'visiting') throw new Error(`Module "uses" cycle: ${[...trail, name].join(' -> ')}`);
        state.set(name, 'visiting');
        for (const use of byName.get(name)!.uses ?? []) {
            if (!byName.has(use)) throw new Error(`Module "${name}" uses unknown module "${use}"`);
            visit(use, [...trail, name]);
        }
        state.set(name, 'done');
        order.push(name);
    };
    for (const m of manifests) visit(m.name, []);
    return order;
}

export function manifestComposition(m: HadarsManifest): Extract<CompositionOptions, { role: 'module' }> {
    validateManifest(m);
    return {
        role: 'module', name: m.name, exposes: m.exposes,
        ...(m.shared ? { shared: m.shared } : {}), ...(m.requires ? { requires: m.requires } : {}),
        ...(m.clientOnly ? { clientOnly: true } : {}),
    };
}
