import { createHash } from 'node:crypto';
import { satisfies, valid, validRange } from 'semver';
import { computeBuildId } from '../../composition/identity';
import type { BuildManifest } from '../../composition/artifacts';

export type { BuildManifest };
export const buildIdFor = (m: BuildManifest): string => computeBuildId(m);

/** Same identity a pinned lock uses for its snapshot. */
export function snapshotIdFor(s: { shell: string; modules: Record<string, string>; libraries: Record<string, string> }): string {
    const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
    return 'snap_' + createHash('sha256').update(JSON.stringify({ shell: s.shell, modules: sorted(s.modules), libraries: sorted(s.libraries) })).digest('hex').slice(0, 16);
}

export function assertNativeLockCompatibility(shell: BuildManifest, modules: BuildManifest[], libraries: BuildManifest[]): void {
    for (const m of [shell, ...modules, ...libraries]) {
        if (!['1', '2'].includes(m.runtimeContract) || !['production', 'dev'].includes(m.flavour)) throw new Error('Incompatible native lock runtime contract or flavour');
    }
    for (const m of modules) {
        if (m.flavour !== shell.flavour) throw new Error('Native lock flavour differs from shell');
        for (const [pkg, range] of Object.entries(m.requires)) {
            const version = Array.isArray(shell.provides) ? undefined : shell.provides[pkg];
            if (!validRange(range) || !version || !valid(version) || !satisfies(version, range)) throw new Error(`Native lock module ${m.name} requires ${pkg} ${range}`);
        }
    }
}
