import { valid } from 'semver';
import { assertVersionContracts } from './versions';
import { hash, canonical, computeBuildId } from './identity';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { PinnedBuild, PinnedBuildsOptions } from './pinnedTypes';
import { DEFAULT_SHARED, type TargetManifest } from './constants';

const safe = (p: unknown): p is string => typeof p === 'string' && !!p && !/[\\\0]/.test(p) && !/^[A-Za-z]:/.test(p)
    && !p.split('/').some((s) => !s || s === '.' || s === '..');
const record = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: any): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
const verified = new Map<string, string>();

/** Validates the complete pin set before any entry is evaluated. Dev reuses unchanged file hashes. */
export async function resolvePinnedBuilds(options: PinnedBuildsOptions, dev = false): Promise<Record<string, PinnedBuild>> {
    const fail = (name: string, detail: string): never => { throw new Error(`[hadars] Pinned build "${name}": ${detail}. Restore the pinned files and lock file before starting.`); };
    let lock: any;
    try { lock = JSON.parse(await readFile(options.lockFile, 'utf8')); }
    catch { return fail(options.lockFile, 'cannot read lock file as JSON'); }
    const s = lock?.snapshot;
    if (lock?.version !== 1 || !record(lock.builds) || !s || !record(s.modules) || !record(s.libraries)
        || ![s.shell, ...Object.values(s.modules), ...Object.values(s.libraries)].every((v) => typeof v === 'string' && /^[a-f0-9]{16}$/.test(v))) fail(options.lockFile, 'expected a v1 lock with exact build IDs');
    const sorted = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    const snapshotId = 'snap_' + hash(JSON.stringify({ shell: s.shell, modules: sorted(s.modules), libraries: sorted(s.libraries) })).slice(0, 16);
    if (s.id !== snapshotId || lock.snapshotId !== s.id || lock.snapshotSha256 !== hash(canonical(s))) fail(options.lockFile, 'snapshot identity/checksum mismatch');
    const pins: Array<[string | undefined, string, PinnedBuild['kind']]> = [
        [undefined, s.shell, 'shell'],
        ...Object.entries(s.modules).map(([name, id]) => [name, id, 'module'] as [string, string, 'module']),
        ...Object.entries(s.libraries).map(([name, id]) => [name, id, 'library'] as [string, string, 'library']),
    ];
    if (new Set(pins.map(([, id]) => id)).size !== Object.keys(lock.builds).length) fail(options.lockFile, 'unexpected or missing builds');
    let integrity: Record<string, string> = {};
    try {
        integrity = JSON.parse(await readFile(options.integrityFile ?? path.join(options.buildsDir, '..', 'integrity.json'), 'utf8'));
        if (!record(integrity)) throw new Error('expected an object mapping artifact paths to SRI values');
    } catch (e: any) { if (e.code !== 'ENOENT') fail(options.lockFile, `cannot read integrity map: ${e.message}`); }
    let publicBase = options.publicBase ?? '/_builds/';
    try {
        const local = publicBase.startsWith('/') && !publicBase.startsWith('//');
        if ((!local && !/^https?:\/\//.test(publicBase)) || /[?#]/.test(publicBase)) throw new Error('invalid URL prefix');
        const url = new URL(publicBase, 'http://hadars.invalid');
        if (url.username || url.password || (local && url.origin !== 'http://hadars.invalid')) throw new Error('invalid URL origin');
        publicBase = local ? url.pathname : url.href;
    } catch { fail(options.lockFile, 'publicBase must be a local URL path or an HTTP(S) URL prefix without credentials, query or fragment'); }
    const shell = lock.builds[s.shell]?.manifest;
    const result: Record<string, PinnedBuild> = Object.create(null);
    for (const [pinName, id, kind] of pins) {
        const b = lock.builds[id];
        const m = b?.manifest;
        const name = pinName ?? m?.name ?? id;
        try {
            if (!m || m.kind !== kind || (pinName && m.name !== pinName) || !/^[A-Za-z0-9][\w-]*$/.test(m.name)
                || m.buildId !== id || b.sha256 !== hash(canonical(m))) fail(name, 'manifest identity/checksum mismatch');
            if (result[m.name]) fail(name, 'duplicate build name');
            if (!['1', '2'].includes(m.runtimeContract) || !['production', 'dev'].includes(m.flavour) || (!dev && m.flavour !== 'production')) fail(name, 'incompatible runtime contract or flavour');
            if (!strings(m.exposes) || !strings(m.shared) || !(m.runtimeContract === '1' ? strings(m.provides) : record(m.provides) && Object.values(m.provides).every((v) => typeof v === 'string' && valid(v))) || !record(m.requires) || !Object.values(m.requires).every((v) => typeof v === 'string') || !Array.isArray(m.files)) fail(name, 'invalid manifest');
            if (kind === 'module') {
                if (!m.exposes.length || m.exposes.some((key: string) => !/^[A-Za-z_$][\w$]*$/.test(key))) fail(name, 'invalid exposed namespace');
                assertVersionContracts(name, m.requires, shell?.provides ?? []);
                if (m.flavour !== shell?.flavour) fail(name, 'flavour differs from the pinned shell');
                const provided = new Set([...DEFAULT_SHARED, ...(Array.isArray(shell?.provides) ? shell.provides : Object.keys(shell?.provides ?? {}))]);
                for (const pkg of m.shared) if (!provided.has(pkg)) fail(name, `shared package "${pkg}" is not provided by the pinned shell`);
            }
            if (kind !== 'shell' && Object.keys(m.provides).length) fail(name, 'only a shell can provide shared packages');
            if (m.types !== undefined && !strings(m.types)) fail(name, 'invalid declaration list');
            if (m.typeApi !== undefined && (!record(m.typeApi) || typeof m.typeApi.declarationsSha256 !== 'string' || !record(m.typeApi.exports)
                || !Object.values(m.typeApi.exports).every((v) => record(v) && Object.values(v).every((s) => typeof s === 'string')))) fail(name, 'invalid declaration API metadata');
            // Match the content-derived build identity; optional declaration metadata participates when present.
            if (computeBuildId(m) !== id) fail(name, 'content-derived build ID mismatch');
            const dir = path.resolve(options.buildsDir, id);
            const files = new Set<string>();
            for (const f of m.files) {
                if (!safe(f.path) || files.has(f.path) || !Number.isSafeInteger(f.size) || f.size < 0 || !/^[a-f0-9]{64}$/.test(f.sha256)) fail(name, `invalid file ${f.path}`);
                files.add(f.path);
                const file = path.join(dir, f.path);
                if (await realpath(file) !== file) fail(name, `symlink artifact ${f.path}`);
                const st = await stat(file);
                if (!st.isFile() || st.size !== f.size) fail(name, `size mismatch for ${f.path}`);
                const stamp = `${st.size}:${st.mtimeMs}:${st.ctimeMs}:${f.sha256}`;
                if (!dev || verified.get(file) !== stamp) {
                    if (hash(await readFile(file)) !== f.sha256) fail(name, `sha256 mismatch for ${f.path}`);
                    if (dev) verified.set(file, stamp);
                }
                const sri = integrity[`${id}/${f.path}`];
                if (sri !== undefined && sri !== `sha256-${Buffer.from(f.sha256, 'hex').toString('base64')}`) fail(name, `integrity mismatch for ${f.path}`);
            }
            for (const target of ['client', 'server']) {
                const t = m.targets[target];
                if (!strings(t?.js) || !strings(t?.css) || [...t.js, ...t.css].some((f) => !files.has(f))) fail(name, `undeclared ${target} entry`);
            }
            if (m.types?.some((f: string) => !f.endsWith('.d.ts') || !files.has(f))) fail(name, 'undeclared declaration file');
            if (m.typeApi && m.typeApi.declarationsSha256 !== hash(JSON.stringify([...(m.types ?? [])].sort().map((p) => [p, m.files.find((f: any) => f.path === p)?.sha256])))) fail(name, 'declaration API checksum mismatch');
            const serverEntries = new Set([...m.targets.server.js, ...m.targets.server.css]);
            if ([...m.targets.client.js, ...m.targets.client.css].some((f) => serverEntries.has(f))) fail(name, 'client and server entries overlap');
            if (kind === 'module' && (m.targets.server.js.length !== 1 || !m.targets.client.js.length)) fail(name, 'expected one server entry and at least one client entry');
            const baseUrl = publicBase.replace(/\/?$/, '/') + id + '/';
            result[m.name] = { name: m.name, kind, server: { dir, manifest: m.targets.server }, client: {
                baseUrl, manifest: m.targets.client, files: m.files.map((f: any) => f.path).filter((f: string) => !serverEntries.has(f) && !f.endsWith('.d.ts') && (f.startsWith('client/') || [...m.targets.client.js, ...m.targets.client.css].includes(f))),
                integrity: Object.fromEntries(m.files.filter((f: any) => integrity[`${id}/${f.path}`]).map((f: any) => [f.path, integrity[`${id}/${f.path}`]])),
            } };
        } catch (e: any) {
            if (e.message?.startsWith('[hadars] Pinned build ')) throw e;
            fail(name, e.message);
        }
    }
    if (dev) for (const [name, override] of Object.entries(options.overrides ?? {})) {
        if (result[name]?.kind !== 'module') fail(name, 'local override must name a pinned module');
        const readTarget = async (dir: string): Promise<TargetManifest> => {
            try {
                const target = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
                if (!strings(target?.js) || !strings(target?.css) || [...target.js, ...target.css].some((f) => !safe(f))) throw new Error('invalid entry paths');
                return target;
            } catch (e: any) { return fail(name, `cannot read local manifest in ${dir}: ${e.message}`); }
        };
        let requires = lock.builds[s.modules[name]].manifest.requires;
        try {
            const metadata = JSON.parse(await readFile(path.join(override.serverDir, '..', 'composition.json'), 'utf8'));
            if (!record(metadata.requires) || !Object.values(metadata.requires).every((v) => typeof v === 'string')) throw new Error('invalid requirements');
            requires = metadata.requires;
        } catch (err: any) { if (err.code !== 'ENOENT') fail(name, `cannot read local version contract: ${err.message}`); }
        assertVersionContracts(name, requires, shell.provides);
        result[name] = { name, kind: 'module', server: { dir: path.resolve(override.serverDir), manifest: await readTarget(override.serverDir) },
            client: { baseUrl: override.clientUrl, manifest: await readTarget(path.join(override.serverDir, '..', 'client')) } };
    }
    return result;
}

/** Serves only declared client artifacts when publicBase is a local URL path. */
export async function servePinnedAsset(req: Request, builds: Record<string, PinnedBuild>): Promise<Response | undefined> {
    const pathname = new URL(req.url).pathname;
    for (const build of Object.values(builds)) {
        const { baseUrl, manifest } = build.client;
        if (!baseUrl.startsWith('/') || !pathname.startsWith(baseUrl)) continue;
        let file: string;
        try { file = decodeURIComponent(pathname.slice(baseUrl.length)); }
        catch { return new Response('Not Found', { status: 404 }); }
        // Server entries and declaration files must never become public through this route.
        if (!(build.client.files ?? [...manifest.js, ...manifest.css]).includes(file)) return new Response('Not Found', { status: 404 });
        const body = await readFile(path.join(build.server.dir, file));
        return new Response(new Uint8Array(body), { headers: { 'content-type': file.endsWith('.css') ? 'text/css' : /\.m?js$/.test(file) ? 'text/javascript' : 'application/octet-stream', 'access-control-allow-origin': '*' } });
    }
}
