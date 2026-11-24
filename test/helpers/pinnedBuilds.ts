import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleBuildResult } from '../../src/composition/moduleBuild';

const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const canonical = (v: any): string => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

/** Turns independently built test bundles into the v1 on-disk lock contract. */
export function writePinnedBuilds(dir: string, moduleDir: string, targets: ModuleBuildResult) {
    const buildDir = join(dir, 'builds');
    const integrity: Record<string, string> = {};
    const entries = ['shell', 'greeter'].map((name) => {
        const kind = name === 'shell' ? 'shell' : 'module';
        const files = kind === 'shell' ? [] : ['client', 'server'].flatMap((target) => readdirSync(join(moduleDir, target)).filter((f) => f !== 'manifest.json').map((f) => {
            const bytes = readFileSync(join(moduleDir, target, f));
            return { path: `${target}/${f}`, size: bytes.length, sha256: hash(bytes) };
        })).sort((a, b) => a.path.localeCompare(b.path));
        const m: any = { kind, name, runtimeContract: '1', flavour: 'production', targets: kind === 'shell'
            ? { client: { js: [], css: [] }, server: { js: [], css: [] } }
            : Object.fromEntries(Object.entries(targets).map(([target, t]) => [target, { js: t.js.map((f: string) => `${target}/${f}`), css: t.css.map((f: string) => `${target}/${f}`) }])),
            exposes: kind === 'module' ? ['greeting', 'page'] : [], shared: [], provides: [], requires: {}, files };
        m.buildId = hash(JSON.stringify(m)).slice(0, 16);
        mkdirSync(join(buildDir, m.buildId), { recursive: true });
        if (kind === 'module') for (const target of ['client', 'server']) cpSync(join(moduleDir, target), join(buildDir, m.buildId, target), { recursive: true });
        for (const f of files) integrity[`${m.buildId}/${f.path}`] = 'sha256-' + Buffer.from(f.sha256, 'hex').toString('base64');
        return m;
    });
    const snapshot: any = { shell: entries[0].buildId, modules: { greeter: entries[1].buildId }, libraries: {} };
    snapshot.id = 'snap_' + hash(JSON.stringify(snapshot)).slice(0, 16);
    writeFileSync(join(dir, 'hadars.lock'), JSON.stringify({ version: 1, snapshot, snapshotId: snapshot.id, snapshotSha256: hash(canonical(snapshot)), builds: Object.fromEntries(entries.map((manifest) => [manifest.buildId, { manifest, sha256: hash(canonical(manifest)) }])) }));
    writeFileSync(join(dir, 'integrity.json'), JSON.stringify(integrity));
    return entries[1];
}
