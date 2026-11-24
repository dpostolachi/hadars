import { createHash } from 'node:crypto';
import { Range, intersects, minVersion, satisfies, valid, validRange } from 'semver';

/** Core records: manifests, snapshots, channels and environments. */

/** Team IDs appear in storage keys and URLs, so they are restricted to a safe alphabet. */
export const TEAM_ID = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Version of the shell/module runtime contract (`__HADARS_SHARED__` / `__HADARS_MODULES__`). */
export const RUNTIME_CONTRACT = '2';

export type Target = 'client' | 'server';

export interface BuildFile { path: string; size: number; sha256: string }

export interface TargetManifest { js: string[]; css: string[] }
export interface TypeApi {
    declarationsSha256: string;
    exports: Record<string, Record<string, string>>;
}
export interface TypeAdvisory { module: string; namespace?: string; export?: string; kind: string; message: string }
/** Lightweight metadata comparison; compiler work stays in producer CLI and consumer CI. */
export function compareTypeApis(before: BuildManifest, after?: BuildManifest): TypeAdvisory[] {
    if (!before.types?.length) return [];
    const warn = (kind: string, message: string, namespace?: string, name?: string): TypeAdvisory => ({ module: before.name, kind, message, ...(namespace ? { namespace } : {}), ...(name ? { export: name } : {}) });
    if (!after?.types?.length) return [warn('types_missing', `${before.name}: previous declaration surface is missing from candidate`)];
    const changes: TypeAdvisory[] = [];
    if (before.typeApi && after.typeApi) {
        for (const [ns, exports] of Object.entries(before.typeApi.exports)) for (const [name, signature] of Object.entries(exports)) {
            const current = after.typeApi.exports[ns]?.[name];
            if (current === undefined) changes.push(warn('removed_export', `${before.name}/${ns}: removed export ${name}`, ns, name));
            else if (current !== signature) changes.push(warn('changed_signature', `${before.name}/${ns}: signature changed for ${name}; review compatibility`, ns, name));
        }
    }
    if (!changes.length && declarationsHashFor(before.files, before.types) !== declarationsHashFor(after.files, after.types)) changes.push(warn('declarations_changed', `${before.name}: declarations changed; review compatibility (consumer tsc runs in CI)`));
    return changes;
}

export interface VersionMetadata { commit?: string; branch?: string; author?: string; message?: string; label?: string }

/** One published, immutable build of a module, shell or library. */
export interface BuildManifest {
    kind: 'module' | 'shell' | 'library';
    clientOnly?: boolean;
    /** Module: URL patterns it owns (`/x`, `/x/**`), from its `hadars.manifest.ts`. The split routing plan derives from them. */
    mounts?: string[];
    /** Module: the `exposes` entry that holds its route table; requires `mounts`. */
    routes?: string;
    /** Module: other modules it embeds as components, resolved through the shell. */
    uses?: string[];
    /** Original native document; registry metadata never enters its checksum. */
    nativeManifest?: Omit<BuildManifest, 'nativeManifest' | 'sequence' | 'metadata'>;
    sequence?: number;
    metadata?: VersionMetadata;
    name: string;
    /** Content-derived. */
    buildId: string;
    /** Contract between shell and modules; a mismatch must fail validation, not rendering. */
    runtimeContract: string;
    /** Production or dev flavour (a production shell cannot host local Fast Refresh). */
    flavour: 'production' | 'dev';
    targets: Record<Target, TargetManifest>;
    /** Namespaces a module exposes (`exposes` keys in its hadars config); a host reads `module[name].Export`. */
    exposes: string[];
    /** Module: packages it imports from the host instead of bundling (React and its JSX runtimes are implicit). */
    shared: string[];
    /** Shell: packages it makes available to modules, beyond React and its JSX runtimes. */
    provides: string[] | Record<string, string>;
    /** Packages the build expects the shell or a library to provide, with accepted ranges. */
    requires: Record<string, string>;
    /** Declaration files (`.d.ts`, listed in `files`) describing the exposed namespaces; consumers pull them for type checking. */
    types?: string[];
    /** CLI-produced advisory API summary, bound to the declaration file hashes. */
    typeApi?: TypeApi;
    files: BuildFile[];
}

/** Pins one build per name; promoted through channels. */
export interface Snapshot {
    id: string;
    shell: string;
    modules: Record<string, string>;
    libraries: Record<string, string>;
}

/** A signer's vouching for one channel move; see `channelMoveStatement`. */
export interface ChannelSignature { keyId: string; signature: string }
export interface Preview { base: { name: string; revision: number }; overrides: EnvironmentRow[]; expiresAt: number }
export interface Channel { preview?: Preview; name: string; snapshotId: string; version: number; signature?: ChannelSignature }

export interface EnvironmentRow { name: string; kind: BuildManifest['kind']; buildId: string; sequence?: number; metadata?: VersionMetadata }
export interface EnvironmentChange { name: string; kind: BuildManifest['kind']; before?: string; after?: string }
export interface EnvironmentRevision { kind?: 'environment' | 'preview'; preview?: Preview; name: string; revision: number; snapshotId: string; rows: EnvironmentRow[]; changes: EnvironmentChange[] }

export function snapshotIdFor(s: Omit<Snapshot, 'id'>): string {
    const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
    return 'snap_' + createHash('sha256').update(JSON.stringify({ shell: s.shell, modules: sorted(s.modules), libraries: sorted(s.libraries) })).digest('hex').slice(0, 16);
}
export const safeArtifactPath = (p: string) => !!p && !p.startsWith('/') && !p.includes('\\') && !p.includes('\0')
    && !/^[A-Za-z]:/.test(p) && !p.split('/').some((s) => !s || s === '.' || s === '..');

export interface Issue { path: string; message: string }
export type LibraryPolicy = Record<string, string>;
export function validateLibraryPolicy(input: unknown): Issue[] {
    if (!isRecord(input)) return [{ path: 'policy', message: 'policy must map package names to semver ranges' }];
    return Object.entries(input).flatMap(([pkg, pin]) => {
        const ok = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(pkg)
            && typeof pin === 'string' && !!pin.trim() && pin.length <= 256 && validRange(pin) && minVersion(pin);
        return ok ? [] : [{ path: `policy.${pkg}`, message: `invalid package pin ${pkg}: ${String(pin)}` }];
    });
}
/** Publish-time checks; snapshot validation also checks for one common version across all builds. */
export function validateBuildPolicy(b: BuildManifest, policy: LibraryPolicy = {}): Issue[] {
    const issues = validateLibraryPolicy(policy);
    if (issues.length) return issues;
    for (const [pkg, pin] of Object.entries(policy)) {
        const range = b.requires[pkg];
        if (!range && (b.shared.includes(pkg) || (b.kind === 'module' && IMPLICIT_SHARED.includes(pkg)))) issues.push({ path: `requires.${pkg}`, message: `module "${b.name}" package "${pkg}" has no required range for policy "${pin}"` });
        else if (range && (!validRange(range) || !intersects(range, pin))) issues.push({ path: `requires.${pkg}`, message: `module "${b.name}" package "${pkg}" requires "${range}", conflicting with policy "${pin}"` });
    }
    return issues;
}

/** Provided to every module by any shell; mirrors hadars' DEFAULT_SHARED. */
export const IMPLICIT_SHARED = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

// Same rules hadars applies when building a module: the name becomes file names and a browser
// global, each exposes key becomes a generated `export * as <key>`.
const MODULE_NAME = /^[A-Za-z0-9][\w-]*$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
// Same grammar as hadars' split routing patterns.
const MOUNT = /^(?:\/|\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*(?:\/\*\*)?)$/;

/**
 * Content-derived ID: the same bytes and the same declared shape always give the same ID. Fields are
 * listed explicitly and lists sorted, so key order and file order in the input cannot change it.
 */
export function buildIdFor(m: Omit<BuildManifest, 'buildId'>): string {
    // `types` joins the hash only when present, so builds without declarations keep their earlier IDs.
    const types = m.types && m.types.length ? { types: [...m.types].sort() } : {};
    const canonical = JSON.stringify({
        ...(m.clientOnly ? { clientOnly: true } : {}),
        // Ownership joins the hash only when declared, so earlier builds keep their IDs.
        ...(m.mounts?.length ? { mounts: [...m.mounts].sort() } : {}),
        ...(m.routes ? { routes: m.routes } : {}),
        ...(m.uses?.length ? { uses: [...m.uses].sort() } : {}),
        ...types,
        ...(m.typeApi ? { typeApi: { declarationsSha256: m.typeApi.declarationsSha256,
            exports: Object.fromEntries(Object.entries(m.typeApi.exports).sort().map(([ns, exports]) => [ns, Object.fromEntries(Object.entries(exports).sort())])) } } : {}),
        kind: m.kind, name: m.name, runtimeContract: m.runtimeContract, flavour: m.flavour,
        targets: {
            client: { js: m.targets.client.js, css: m.targets.client.css },
            server: { js: m.targets.server.js, css: m.targets.server.css },
        },
        exposes: [...m.exposes].sort(), shared: [...m.shared].sort(), provides: m.runtimeContract === '2' ? Object.fromEntries(Object.entries(m.provides).sort(([a], [b]) => a.localeCompare(b))) : [...m.provides as string[]].sort(),
        requires: Object.fromEntries(Object.entries(m.requires).sort(([a], [b]) => a.localeCompare(b))),
        files: [...m.files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })),
    });
    return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
export function declarationsHashFor(files: BuildFile[], types: string[]) {
    return createHash('sha256').update(JSON.stringify([...types].sort().map((p) => [p, files.find((f) => f.path === p)?.sha256]))).digest('hex');
}

/** Structural check for data that arrives over the wire; `validateBuild` assumes this passes. */
export function validateShape(b: unknown): Issue[] {
    if (!isRecord(b)) return [{ path: '', message: 'a build manifest must be a JSON object' }];
    const issues: Issue[] = [];
    const need = (ok: boolean, path: string, message: string) => { if (!ok) issues.push({ path, message }); };
    need(b.kind === 'module' || b.kind === 'shell' || b.kind === 'library', 'kind', 'must be "module", "shell" or "library"');
    need(b.metadata === undefined || (isRecord(b.metadata) && Object.entries(b.metadata).every(([k, v]) => ['commit', 'branch', 'author', 'message', 'label'].includes(k) && typeof v === 'string' && v.length <= 4096)), 'metadata', 'must contain optional git metadata strings (max 4096 characters)');
    need(typeof b.name === 'string', 'name', 'must be a string');
    need(typeof b.buildId === 'string', 'buildId', 'must be a string');
    need(b.runtimeContract === '1' || b.runtimeContract === '2', 'runtimeContract', 'supported contracts are 1 and 2');
    need(b.flavour === 'production' || b.flavour === 'dev', 'flavour', 'must be "production" or "dev"');
    for (const key of ['exposes', 'shared'] as const) need(isStrings(b[key]), key, 'must be a list of strings');
    need(b.runtimeContract === '2' ? isRecord(b.provides) && Object.values(b.provides).every((v) => typeof v === 'string' && !!valid(v)) : isStrings(b.provides), 'provides', 'contract 2 requires a version map; contract 1 requires a list of strings');
    need(b.clientOnly === undefined || b.clientOnly === true && b.kind === 'module', 'clientOnly', 'must be true on a module or absent');
    need(b.mounts === undefined || (isStrings(b.mounts) && b.mounts.length > 0 && b.kind === 'module'), 'mounts', 'must be a nonempty list of strings on a module');
    need(b.uses === undefined || (isStrings(b.uses) && b.kind === 'module'), 'uses', 'must be a list of module names on a module');
    need(b.routes === undefined || (typeof b.routes === 'string' && b.kind === 'module'), 'routes', 'must be an exposed namespace name on a module');
    need(b.types === undefined || isStrings(b.types), 'types', 'must be a list of strings');
    need(b.typeApi === undefined || (isRecord(b.typeApi) && typeof b.typeApi.declarationsSha256 === 'string' && isRecord(b.typeApi.exports)
        && Object.values(b.typeApi.exports).every((v) => isRecord(v) && Object.values(v).every((s) => typeof s === 'string'))), 'typeApi', 'must contain a declaration checksum and exported signatures');
    need(isRecord(b.requires) && Object.values(b.requires).every((v) => typeof v === 'string'), 'requires', 'must map package names to ranges');
    for (const t of ['client', 'server'] as const) {
        const target = isRecord(b.targets) ? b.targets[t] : undefined;
        need(isRecord(target) && isStrings(target.js) && isStrings(target.css), `targets.${t}`, 'must have js and css lists of strings');
    }
    need(Array.isArray(b.files) && b.files.every((f) => isRecord(f) && typeof f.path === 'string'
        && Number.isInteger(f.size) && (f.size as number) >= 0 && typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256)),
        'files', 'must list { path, size, sha256 } with a 64 character hex sha256');
    return issues;
}

/** Pure: shared by the registry, `publish --dry-run` and CI. */
export function validateBuild(input: BuildManifest | unknown): Issue[] {
    const shape = validateShape(input);
    if (shape.length) return shape;
    const b = input as BuildManifest;
    const issues: Issue[] = [];
    if (!b.name) issues.push({ path: 'name', message: 'name is required' });
    if (!b.buildId) issues.push({ path: 'buildId', message: 'buildId is required' });
    else if (b.buildId !== buildIdFor(b)) issues.push({ path: 'buildId', message: 'buildId does not match the content' });
    if (b.nativeManifest !== undefined) {
        const { nativeManifest, sequence, metadata, ...document } = b;
        if (!isRecord(nativeManifest) || ['nativeManifest', 'sequence', 'metadata'].some((k) => k in nativeManifest)
            || canonicalJson(nativeManifest) !== canonicalJson(document)) issues.push({ path: 'nativeManifest', message: 'native document must match the published build exactly' });
    }
    if (b.name && !MODULE_NAME.test(b.name)) {
        issues.push({ path: 'name', message: `invalid name "${b.name}": letters, digits, "_" and "-" only` });
    }
    if (b.kind === 'module') {
        if (b.exposes.length === 0) issues.push({ path: 'exposes', message: 'a module must expose at least one namespace' });
        for (const key of b.exposes) {
            if (!IDENT.test(key)) issues.push({ path: 'exposes', message: `"${key}" is not a valid identifier` });
        }
    }
    for (const mount of b.mounts ?? []) {
        if (!MOUNT.test(mount)) issues.push({ path: 'mounts', message: `${JSON.stringify(mount)} must be "/" or a literal path, optionally ending in "/**"` });
    }
    if (new Set(b.mounts ?? []).size !== (b.mounts ?? []).length) issues.push({ path: 'mounts', message: 'duplicate mounts' });
    if (b.routes !== undefined && !b.exposes.includes(b.routes)) issues.push({ path: 'routes', message: `"${b.routes}" is not an exposed namespace` });
    if (b.routes !== undefined && !b.mounts?.length) issues.push({ path: 'routes', message: 'a route table needs mounts' });
    for (const use of b.uses ?? []) {
        if (!MODULE_NAME.test(use)) issues.push({ path: 'uses', message: `"${use}" is not a module name` });
        else if (use === b.name) issues.push({ path: 'uses', message: 'a module cannot use itself' });
    }
    if (b.kind !== 'shell' && Object.keys(b.provides).length > 0) issues.push({ path: 'provides', message: 'only a shell provides packages' });
    const known = new Set(b.files.map((f) => f.path));
    if (known.size !== b.files.length) issues.push({ path: 'files', message: 'duplicate artifact paths' });
    for (const f of b.files) if (!safeArtifactPath(f.path)) issues.push({ path: f.path, message: 'unsafe artifact path' });
    for (const t of ['client', 'server'] as const) {
        for (const f of [...b.targets[t].js, ...b.targets[t].css]) {
            if (!known.has(f)) issues.push({ path: `targets.${t}`, message: `${f} is not in files` });
        }
    }
    for (const f of b.types ?? []) {
        if (!f.endsWith('.d.ts')) issues.push({ path: 'types', message: `${f} is not a .d.ts file` });
        else if (!known.has(f)) issues.push({ path: 'types', message: `${f} is not in files` });
    }
    if (b.typeApi && b.typeApi.declarationsSha256 !== declarationsHashFor(b.files, b.types ?? [])) issues.push({ path: 'typeApi', message: 'API summary does not match declaration checksums; run types again' });
    for (const [pkg, range] of Object.entries(b.requires)) {
        if (!range.trim() || !validRange(range)) issues.push({ path: `requires.${pkg}`, message: `invalid range ${range}` });
    }
    return issues;
}

/** Pure: every module must agree with the shell's runtime contract and pin a single build per name. */
export function validateSnapshot(
    s: Snapshot,
    builds: Record<string, BuildManifest>,
    policy: LibraryPolicy = {},
): Issue[] {
    const issues: Issue[] = validateLibraryPolicy(policy);
    if (issues.length) return issues;
    const shell = builds[s.shell];
    if (!shell) return [{ path: 'shell', message: `unknown build ${s.shell}` }];
    if (shell.kind !== 'shell') issues.push({ path: 'shell', message: 'shell slot must contain a shell build' });
    const selected = [...new Set([s.shell, ...Object.values(s.modules), ...Object.values(s.libraries)])].map((id) => builds[id]).filter(Boolean);
    if (new Set(selected.map((b) => b.name)).size !== selected.length) issues.push({ path: 'builds', message: 'shell, modules and libraries must have distinct names for type resolution' });
    for (const [name, id] of Object.entries(s.libraries)) {
        const lib = builds[id];
        if (!lib || lib.kind !== 'library' || lib.name !== name) issues.push({ path: `libraries.${name}`, message: `library ${name} must pin a matching library build` });
    }
    for (const b of selected) issues.push(...validateBuildPolicy(b, policy));
    issues.push(...validateUses(selected));
    for (const [pkg, pin] of Object.entries(policy)) {
        let candidates = [pin];
        for (const b of selected) {
            const range = b.requires[pkg];
            if (!range || !validRange(range)) continue;
            const next = new Set<string>();
            for (const candidate of candidates) for (const a of new Range(candidate).set) for (const c of new Range(range).set) {
                const combined = [...a, ...c].map((x) => x.value).filter(Boolean).join(' ') || '*';
                const min = minVersion(combined);
                if (min && satisfies(min, combined)) next.add(combined);
                if (next.size > 128) return [...issues, { path: `policy.${pkg}`, message: `module "${b.name}" package "${pkg}" range "${range}" exceeds policy range complexity` }];
            }
            candidates = [...next];
            if (!candidates.length) { issues.push({ path: `requires.${pkg}`, message: `module "${b.name}" package "${pkg}" requires "${range}"; no common version across snapshot requirements and policy "${pin}"` }); break; }
        }
    }
    for (const [name, id] of Object.entries(s.modules)) {
        const m = builds[id];
        if (!m) { issues.push({ path: `modules.${name}`, message: `unknown build ${id}` }); continue; }
        if (m.kind !== 'module') issues.push({ path: `modules.${name}`, message: 'module slot must contain a module build' });
        if (m.runtimeContract !== shell.runtimeContract) {
            issues.push({ path: `modules.${name}`, message: `runtime contract ${m.runtimeContract} != shell ${shell.runtimeContract}` });
        }
        if (m.flavour !== shell.flavour) {
            issues.push({ path: `modules.${name}`, message: `flavour ${m.flavour} != shell ${shell.flavour}` });
        }
        // An unprovided package fails silently or at load time in the browser, so catch it here.
        const provided = new Set([...IMPLICIT_SHARED, ...(Array.isArray(shell.provides) ? shell.provides : Object.keys(shell.provides))]);
        for (const pkg of m.shared) {
            if (!provided.has(pkg)) issues.push({ path: `modules.${name}`, message: `needs "${pkg}", which the shell does not provide` });
        }
        if (!Array.isArray(shell.provides) || m.runtimeContract === '2') for (const [pkg, range] of Object.entries(m.requires)) {
            const version = Array.isArray(shell.provides) ? undefined : shell.provides[pkg];
            if (!version || !valid(version) || !satisfies(version, range)) issues.push({ path: `modules.${name}`, message: `requires "${pkg}" range "${range}"; shell provides "${version ?? 'missing'}"` });
        }
        if (m.name !== name) issues.push({ path: `modules.${name}`, message: `build is named "${m.name}", not "${name}"` });
    }
    return issues;
}

export { sealBlob, openBlob, gcmSeal, gcmOpen, SEAL_OVERHEAD } from './seal';
export { channelMoveStatement, signingKeyId, generateSigningKey, validPublicKey, signStatement, verifyStatement, sriFromHex } from './signing';

/** Native checksum canonicalization matches hadars composition/identity. */
export const canonicalJson = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const nativeBuildManifest = (manifest: BuildManifest): BuildManifest => manifest.nativeManifest ?? manifest;

/** Compatibility rules used by the producer's native assembleLockfile. */
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

/** Every `uses` entry must name a module in the same selection, and the graph must be acyclic. */
export function validateUses(selected: BuildManifest[]): Issue[] {
    const issues: Issue[] = [];
    const modules = new Map(selected.filter((b) => b.kind === 'module').map((b) => [b.name, b]));
    for (const b of modules.values()) for (const use of b.uses ?? []) {
        if (!modules.has(use)) issues.push({ path: `uses.${b.name}`, message: `module "${b.name}" uses "${use}", which is not a module in this snapshot` });
    }
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (name: string, trail: string[]): boolean => {
        if (state.get(name) === 'done') return true;
        if (state.get(name) === 'visiting') { issues.push({ path: 'uses', message: `uses cycle: ${[...trail, name].join(' -> ')}` }); return false; }
        state.set(name, 'visiting');
        for (const use of modules.get(name)?.uses ?? []) if (modules.has(use) && !visit(use, [...trail, name])) return false;
        state.set(name, 'done');
        return true;
    };
    for (const name of modules.keys()) if (!visit(name, [])) break;
    return issues;
}
