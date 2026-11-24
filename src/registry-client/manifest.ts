import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { RUNTIME_CONTRACT, IMPLICIT_SHARED, buildIdFor, validateBuild, type BuildFile, type BuildManifest, type TargetManifest } from '../registry-protocol';

/** The subset of a module's hadars `composition` config the platform reads. */
export interface ModuleConfig {
    name: string;
    exposes: Record<string, string>;
    shared?: string[];
    requires?: Record<string, string>;
}

export interface ManifestOptions {
    /** Output directory of hadars' `buildModule` (contains `client/` and `server/`). */
    outDir: string;
    composition: ModuleConfig;
    flavour?: BuildManifest['flavour'];
    projectDir?: string;
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

function listFiles(root: string, dir = ''): string[] {
    return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? listFiles(root, path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

/** Reads a module build's output and describes it as an immutable, content-addressed build. */
export function createBuildManifest({ outDir, composition, flavour = 'production', projectDir }: ManifestOptions): BuildManifest {
    const targets = {} as BuildManifest['targets'];
    for (const target of ['client', 'server'] as const) {
        const file = path.join(outDir, target, 'manifest.json');
        let listed: TargetManifest;
        try {
            listed = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
            throw new Error(`No ${target} build found at ${file}. Run the module build first.`);
        }
        targets[target] = { js: listed.js.map((f) => `${target}/${f}`), css: listed.css.map((f) => `${target}/${f}`) };
    }

    // Only what the build manifests list is published; the barrel and other build scratch files are not.
    const listed = new Set([...targets.client.js, ...targets.client.css, ...targets.server.js, ...targets.server.css,
        'client/manifest.json', 'server/manifest.json']);
    // Declarations are optional: a module build that emits `types/**/*.d.ts` publishes them with the build.
    const types = existsSync(path.join(outDir, 'types'))
        ? listFiles(outDir, 'types').map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith('.d.ts')).sort()
        : [];
    for (const f of types) listed.add(f);
    const files: BuildFile[] = listFiles(outDir).map((f) => f.split(path.sep).join('/')).filter((f) => listed.has(f)).sort().map((f) => {
        const data = readFileSync(path.join(outDir, f));
        return { path: f, size: statSync(path.join(outDir, f)).size, sha256: sha256(data) };
    });

    const body = {
        kind: 'module' as const,
        name: composition.name,
        runtimeContract: RUNTIME_CONTRACT,
        flavour,
        targets,
        exposes: Object.keys(composition.exposes).sort(),
        shared: [...(composition.shared ?? [])].sort(),
        provides: {} as Record<string, string>,
        requires: { ...(projectDir ? requirementsFromProject(projectDir, composition.shared ?? []) : {}), ...composition.requires },
        ...(existsSync(path.join(outDir, 'types/api.json')) ? { typeApi: JSON.parse(readFileSync(path.join(outDir, 'types/api.json'), 'utf8')) } : {}),
        ...(types.length ? { types } : {}),
        files,
    };
    // Same bytes and same declared shape give the same ID, so republishing an unchanged build is a no-op.
    return { ...body, buildId: buildIdFor(body) };
}
function requirementsFromProject(project: string, shared: string[]) {
    let pkg: any;
    try { pkg = JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw e; }
    const require = createRequire(path.resolve(project, 'package.json'));
    return Object.fromEntries([...new Set([...shared, ...IMPLICIT_SHARED].map((p) => p.startsWith('@') ? p.split('/').slice(0, 2).join('/') : p.split('/')[0]))].flatMap((name) => {
        let version = pkg.peerDependencies?.[name] ?? pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
        try { version = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version; } catch { /* declared range is the fallback for packages hiding package.json */ }
        return typeof version === 'string' ? [[name, version]] : [];
    }));
}

/** Prebuilt inputs are data only: never load producer config or infer dependencies. */
export function readNativeManifest(file: string, outDir: string, kind?: string): BuildManifest {
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as BuildManifest;
    if (manifest && ['nativeManifest', 'sequence', 'metadata'].some((k) => k in manifest)) throw new Error('Expected a native manifest without registry fields');
    const issues = validateBuild(manifest);
    if (issues.length) throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    if (kind && manifest.kind !== kind) throw new Error(`Manifest kind ${manifest.kind} does not match --kind ${kind}`);
    verifyBuildFiles(outDir, manifest);
    return { ...manifest, nativeManifest: manifest };
}

/** Check every declared byte, including auxiliary chunks, before declaring a publish. */
export function verifyBuildFiles(outDir: string, manifest: BuildManifest): Map<string, Buffer> {
    const issues = validateBuild(manifest);
    if (issues.length) throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    const root = path.resolve(outDir);
    const files = new Map<string, Buffer>();
    for (const f of manifest.files) {
        let current = root;
        for (const segment of ['', ...f.path.split('/')]) {
            current = path.join(current, segment);
            if (lstatSync(current).isSymbolicLink()) throw new Error(`Symlink build path: ${f.path}`);
        }
        const bytes = readFileSync(path.join(root, f.path));
        if (bytes.length !== f.size || sha256(bytes) !== f.sha256) throw new Error(`Build file checksum mismatch: ${f.path}`);
        files.set(f.path, bytes);
    }
    return files;
}
