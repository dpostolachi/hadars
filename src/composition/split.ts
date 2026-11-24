import type { PinnedBuild } from './pinnedTypes';

export type SplitOptions = { mode: 'single' } | {
    mode: 'per-module';
    defaultGroup: string;
    /** Overrides and additions; a pinned module's manifest `mounts` apply when absent here. */
    mounts?: Record<string, string[]>;
    budgets?: { unitBytes: number };
};
export interface SplitGroup {
    name: string;
    patterns: string[];
    modules: string[];
    unit: { file: string; sha256: string; size: number };
}
export interface SplitManifest {
    version: 1;
    releaseId: string;
    mode: 'per-module';
    defaultGroup: string;
    shell: string;
    snapshot: string;
    probe: { path: '/__hadars/release' };
    budgets: { unitBytes: number };
    groups: SplitGroup[];
}
type Routes = Pick<SplitManifest, 'defaultGroup'> & { groups: Array<Pick<SplitGroup, 'name' | 'patterns'>> };
const namePattern = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
export function literalPrefix(pattern: string): string {
    if (typeof pattern !== 'string' || !/^(?:\/|\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*(?:\/\*\*)?)$/.test(pattern)) {
        throw new Error(`SPLIT_PATTERN_INVALID: ${JSON.stringify(pattern)}`);
    }
    return pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function ordered<T extends Pick<SplitGroup, 'name' | 'patterns'>>(groups: T[], defaultGroup: string): T[] {
    const length = (g: T) => Math.max(0, ...g.patterns.map(p => literalPrefix(p).length));
    return [...groups].sort((a, b) => a.name === defaultGroup ? 1 : b.name === defaultGroup ? -1 : length(b) - length(a) || compare(a.name, b.name));
}
export function validateRoutes(manifest: Routes): void {
    if (typeof manifest.defaultGroup !== 'string' || !namePattern.test(manifest.defaultGroup) || ['.', '..'].includes(manifest.defaultGroup)) throw new Error('SPLIT_DEFAULT_INVALID: defaultGroup must be a safe nonempty group name');
    const names = new Set<string>();
    const patterns: Array<{ pattern: string; prefix: string; group: string }> = [];
    for (const group of manifest.groups) {
        if (typeof group.name !== 'string' || !namePattern.test(group.name) || group.name === '.' || group.name === '..' || names.has(group.name)) throw new Error(`SPLIT_GROUP_INVALID: ${group.name}`);
        names.add(group.name);
        if (!Array.isArray(group.patterns) || (group.name === manifest.defaultGroup ? group.patterns.length !== 0 : group.patterns.length === 0)) throw new Error(`SPLIT_PATTERNS_INVALID: ${group.name}`);
        for (const pattern of group.patterns) {
            const prefix = literalPrefix(pattern);
            for (const previous of patterns) {
                if (previous.group === group.name) continue;
                const contains = (a: string, b: string) => a === b || a === '/' || b.startsWith(a + '/');
                if (contains(prefix, previous.prefix) || contains(previous.prefix, prefix)) {
                    throw new Error(`SPLIT_PATTERN_NESTED: ${previous.pattern} (${previous.group}) and ${pattern} (${group.name})`);
                }
            }
            patterns.push({ pattern, prefix, group: group.name });
        }
    }
    if (!names.has(manifest.defaultGroup)) throw new Error(`SPLIT_DEFAULT_MISSING: ${manifest.defaultGroup}`);
    if (manifest.groups.some((g, i) => ordered(manifest.groups, manifest.defaultGroup)[i] !== g)) throw new Error('SPLIT_GROUP_ORDER: groups must be in routing precedence order');
}
export function splitBudget(budgets: { unitBytes: number }): number {
    if (!budgets || !Number.isSafeInteger(budgets.unitBytes) || budgets.unitBytes <= 0) throw new Error('SPLIT_BUDGET_INVALID: unitBytes must be a positive safe integer');
    return budgets.unitBytes;
}
export function splitGroups(split: SplitOptions | undefined, builds?: Record<string, PinnedBuild>): SplitGroup[] | undefined {
    if (!split || split.mode === 'single') return undefined;
    if (split.mode !== 'per-module') throw new Error('SPLIT_MODE_INVALID: expected single or per-module');
    if (!builds) throw new Error('SPLIT_PINNED_REQUIRED: per-module requires a pinned shell lock');
    if (split.mounts !== undefined && (!split.mounts || typeof split.mounts !== 'object' || Array.isArray(split.mounts))) throw new Error('SPLIT_MOUNTS_INVALID: expected module patterns');
    if (split.budgets !== undefined) splitBudget(split.budgets);
    const modules = Object.values(builds).filter(b => b.kind === 'module');
    // A module's own manifest owns its paths; explicit mounts override it.
    const mounts: Record<string, string[]> = {
        ...Object.fromEntries(modules.filter(b => b.mounts?.length).map(b => [b.name, b.mounts!])),
        ...split.mounts,
    };
    for (const name of Object.keys(mounts)) {
        if (!modules.some(b => b.name === name)) throw new Error(`SPLIT_MODULE_UNKNOWN: ${name}`);
        if (name === split.defaultGroup) throw new Error(`SPLIT_DEFAULT_COLLISION: ${name} is also a mounted module`);
    }
    for (const b of modules) if (!Object.hasOwn(mounts, b.name) && !b.clientOnly) throw new Error(`SPLIT_MODULE_UNMOUNTED: ${b.name}; mount it or declare the pinned module client-only`);
    const unit = () => ({ file: '', sha256: '', size: 0 });
    for (const [name, patterns] of Object.entries(mounts)) {
        if (!Array.isArray(patterns) || patterns.length === 0) throw new Error(`SPLIT_PATTERNS_INVALID: ${name}`);
        patterns.forEach(literalPrefix);
    }
    const groups = ordered([
        { name: split.defaultGroup, patterns: [], modules: [], unit: unit() },
        ...Object.entries(mounts).map(([name, patterns]) => ({ name, patterns, modules: [name], unit: unit() })),
    ], split.defaultGroup);
    validateRoutes({ defaultGroup: split.defaultGroup, groups });
    return groups;
}
/** Native rules in manifest order; the final empty-pattern record is the fallback. */
export function routingPlan(manifest: Routes): Array<{ group: string; patterns: string[] }> {
    validateRoutes(manifest);
    return manifest.groups.map(g => ({ group: g.name, patterns: [...g.patterns] }));
}
/** Raw pathname: never decode percent escapes or normalize slashes/dot segments. */
export function matchGroup(manifest: Routes, pathname: string): string {
    const raw = pathname.split(/[?#]/, 1)[0]!;
    for (const { group, patterns } of routingPlan(manifest)) {
        if (patterns.some(p => p.endsWith('/**') ? raw === p.slice(0, -3) || raw.startsWith(p.slice(0, -3) + '/') : raw === p)) return group;
    }
    return manifest.defaultGroup;
}
