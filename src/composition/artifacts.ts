import { CompositionCompatibilityError } from './errors';
import { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { TargetManifest } from './constants';
import type { BuildModuleOptions, ModuleBuildResult } from './moduleBuild';
import { resolveModuleRequires, assertVersionContracts } from './versions';
import type { ModuleTypes } from './moduleTypes';
import { hash, canonical, computeBuildId } from './identity';

export interface BuildManifest {
    kind: 'shell' | 'module' | 'library';
    name: string;
    buildId: string;
    runtimeContract: string;
    flavour: 'production' | 'dev';
    targets: { client: TargetManifest; server: TargetManifest };
    exposes: string[];
    shared: string[];
    provides: string[] | Record<string, string>;
    requires: Record<string, string>;
    files: Array<{ path: string; size: number; sha256: string }>;
    clientOnly?: boolean;
    /** Paths the module owns; the split routing plan derives from them. */
    mounts?: string[];
    routes?: string;
    uses?: string[];
    types?: string[];
    typeApi?: { declarationsSha256: string; exports: Record<string, Record<string, string>> };
}

export interface CreateBuildOptions {
    sourceDir: string;
    buildsDir: string;
    kind: BuildManifest['kind'];
    name: string;
    /** Paths relative to sourceDir, already prefixed with client/ or server/ as appropriate. */
    targets: BuildManifest['targets'];
    flavour?: BuildManifest['flavour'];
    exposes?: string[];
    shared?: string[];
    provides?: string[] | Record<string, string>;
    runtimeContract?: '1' | '2';
    requires?: Record<string, string>;
    clientOnly?: boolean;
    mounts?: string[];
    routes?: string;
    uses?: string[];
    types?: string[];
    typeApi?: BuildManifest['typeApi'];
}

/** Read a complete artifact tree; symlinks and non-files cannot enter an immutable build. */
export function readBuildFiles(dir: string, prefix = ''): Map<string, Buffer> {
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error(`Unsafe build directory: ${dir}`);
    const files = new Map<string, Buffer>();
    for (const name of readdirSync(dir).sort()) {
        const file = path.join(dir, name);
        const relative = prefix + name;
        if (/[\\\0]/.test(name)) throw new Error(`Unsafe build file: ${relative}`);
        const st = lstatSync(file);
        if (st.isSymbolicLink()) throw new Error(`Symlink build file: ${relative}`);
        if (st.isDirectory()) for (const [p, bytes] of readBuildFiles(file, relative + '/')) files.set(p, bytes);
        else if (st.isFile()) files.set(relative, readFileSync(file));
        else throw new Error(`Not a build file: ${relative}`);
    }
    return files;
}

export function createIntegrityMap(manifests: BuildManifest[]): Record<string, string> {
    return Object.fromEntries(manifests.flatMap((m) => m.files.map((f) =>
        [`${m.buildId}/${f.path}`, `sha256-${Buffer.from(f.sha256, 'hex').toString('base64')}`])));
}

/** Snapshot source bytes once, derive v1 identity, and publish without overwriting an existing build. */
export function createBuild(opts: CreateBuildOptions) {
    const bytes = readBuildFiles(path.resolve(opts.sourceDir));
    const files = [...bytes].map(([p, body]) => ({ path: p, size: body.length, sha256: hash(body) }));
    if (!files.length) throw new Error(`Build "${opts.name}" has no files`);
    for (const t of Object.values(opts.targets)) for (const p of [...t.js, ...t.css]) {
        if (!bytes.has(p)) throw new Error(`Build "${opts.name}" has undeclared or missing entry ${p}`);
    }
    const contract = opts.runtimeContract ?? (opts.provides && !Array.isArray(opts.provides) || Object.keys(opts.requires ?? {}).length ? '2' : '1');
    if (contract === '1' && opts.provides && !Array.isArray(opts.provides)) throw new Error('Versioned provides require manifest contract 2');
    if (contract === '2' && Array.isArray(opts.provides) && opts.provides.length) throw new Error('Contract 2 provides must map packages to versions');
    const content: Omit<BuildManifest, 'buildId'> = {
        ...(opts.clientOnly ? { clientOnly: true } : {}),
        ...(opts.mounts?.length ? { mounts: opts.mounts } : {}), ...(opts.routes ? { routes: opts.routes } : {}),
        ...(opts.uses?.length ? { uses: opts.uses } : {}),
        ...(opts.types ? { types: opts.types } : {}), ...(opts.typeApi ? { typeApi: opts.typeApi } : {}),
        kind: opts.kind, name: opts.name, runtimeContract: contract, flavour: opts.flavour ?? 'production',
        targets: opts.targets, exposes: opts.exposes ?? [], shared: opts.shared ?? [],
        provides: contract === '2' ? (Array.isArray(opts.provides) ? {} : opts.provides ?? {}) : opts.provides ?? [], requires: opts.requires ?? {}, files,
    };
    const manifest = { ...content, buildId: computeBuildId(content) };
    const dir = path.resolve(opts.buildsDir, manifest.buildId);
    mkdirSync(path.resolve(opts.buildsDir), { recursive: true });
    try {
        const existing = readBuildFiles(dir);
        if (existing.size !== bytes.size || [...bytes].some(([p, body]) => !existing.get(p)?.equals(body))) {
            throw new Error(`Immutable build ${manifest.buildId} already exists with different files`);
        }
    } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
        const staging = mkdtempSync(path.join(path.resolve(opts.buildsDir), '.build-'));
        try {
            for (const [p, body] of bytes) {
                mkdirSync(path.dirname(path.join(staging, p)), { recursive: true });
                writeFileSync(path.join(staging, p), body);
            }
            renameSync(staging, dir);
        } finally { rmSync(staging, { recursive: true, force: true }); }
    }
    return { manifest, dir, integrity: createIntegrityMap([manifest]) };
}

/** Convert buildModule's target-relative output into an immutable pin. Includes chunks and assets. */
export function createModuleBuild(opts: BuildModuleOptions & { moduleTypes?: ModuleTypes; buildsDir: string; result: ModuleBuildResult; requires?: Record<string, string> }) {
    // The generated source barrel is not an artifact; collect only the two output trees.
    const staging = mkdtempSync(path.join(path.resolve(opts.outDir), '.pin-'));
    try {
        for (const target of ['client', 'server'] as const) for (const [p, body] of readBuildFiles(path.join(opts.outDir, target), target + '/')) {
            mkdirSync(path.dirname(path.join(staging, p)), { recursive: true });
            writeFileSync(path.join(staging, p), body);
        }
        // Declarations travel with the build so a consumer type-checks against the pinned version.
        const declarations = path.join(opts.outDir, 'types');
        const withTypes = opts.moduleTypes ? readBuildFiles(declarations, 'types/') : undefined;
        for (const [p, body] of withTypes ?? []) {
            mkdirSync(path.dirname(path.join(staging, p)), { recursive: true });
            writeFileSync(path.join(staging, p), body);
        }
        const prefix = (target: 'client' | 'server'): TargetManifest => ({
            js: opts.result[target].js.map((p) => `${target}/${p}`), css: opts.result[target].css.map((p) => `${target}/${p}`),
        });
        return createBuild({ sourceDir: staging, buildsDir: opts.buildsDir, kind: 'module', name: opts.composition.name,
            flavour: opts.mode === 'development' ? 'dev' : 'production', exposes: Object.keys(opts.composition.exposes),
            clientOnly: opts.composition.clientOnly, mounts: opts.manifest?.mounts, routes: opts.manifest?.routes, uses: opts.manifest?.uses,
            shared: opts.composition.shared, types: opts.moduleTypes?.types, typeApi: opts.moduleTypes?.typeApi, requires: { ...resolveModuleRequires(opts), ...opts.requires }, targets: { client: prefix('client'), server: prefix('server') } });
    } finally { rmSync(staging, { recursive: true, force: true }); }
}

/** A shell pin contains actual compiled files, and declares its exact shared specifiers. */
export function createShellBuild(opts: Omit<CreateBuildOptions, 'kind'>) {
    return createBuild({ ...opts, kind: 'shell' });
}

export function assembleLockfile({ shell, modules = [], libraries = [] }: { shell: BuildManifest; modules?: BuildManifest[]; libraries?: BuildManifest[] }) {
    const all = [shell, ...modules, ...libraries];
    if (shell.kind !== 'shell' || modules.some((m) => m.kind !== 'module') || libraries.some((m) => m.kind !== 'library')) throw new Error('Incorrect lock build kind');
    if (new Set(all.map((m) => m.name)).size !== all.length) throw new Error('Duplicate lock build name');
    for (const m of all) if (m.buildId !== computeBuildId(m)) throw new Error(`Build identity mismatch: ${m.name}`);
    for (const m of all) {
        if (!['1', '2'].includes(m.runtimeContract)) throw new CompositionCompatibilityError('incompatible runtime contract or flavour',
            { module: m.name, kind: 'contract', requiredRange: '1 | 2', providedVersion: m.runtimeContract });
        if (!['production', 'dev'].includes(m.flavour)) throw new CompositionCompatibilityError('incompatible runtime contract or flavour',
            { module: m.name, kind: 'flavour', requiredRange: 'production | dev', providedVersion: m.flavour });
    }
    for (const m of modules) {
        assertVersionContracts(m.name, m.requires, shell.provides);
        if (m.flavour !== shell.flavour) throw new CompositionCompatibilityError('flavour differs from the pinned shell',
            { module: m.name, kind: 'flavour', requiredRange: shell.flavour, providedVersion: m.flavour });
    }
    const pins = (builds: BuildManifest[]) => Object.fromEntries([...builds].sort((a, b) => a.name.localeCompare(b.name)).map((m) => [m.name, m.buildId]));
    const identity = { shell: shell.buildId, modules: pins(modules), libraries: pins(libraries) };
    const snapshot = { ...identity, id: 'snap_' + hash(JSON.stringify(identity)).slice(0, 16) };
    return { version: 1, snapshot, snapshotId: snapshot.id, snapshotSha256: hash(canonical(snapshot)),
        builds: Object.fromEntries(all.map((manifest) => [manifest.buildId, { manifest, sha256: hash(canonical(manifest)) }])) };
}
