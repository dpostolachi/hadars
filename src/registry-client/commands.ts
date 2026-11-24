import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateSigningKey, validateBuild, validateBuildPolicy } from '../registry-protocol';
import { ApiError, createClient, resolveTeam, type Client } from './client';
import { createBuildManifest, readNativeManifest, type ModuleConfig } from './manifest';
import { gitMetadata } from './version-metadata';
import { publishBuild } from './publish';
import { login } from './login';
import { pull, outdated } from './pull';
import { readLock, readTrustedKeys, verifyLockSignature } from './lockfile';
import { emitDeclarations } from './declarations';

/** The hosted registry, used when a project has no lock file and no registry is named. */
export const DEFAULT_REGISTRY = 'https://registry.hadars.xyz';

const isLoopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/**
 * Chooses the registry for this command. A project's lock file pins the registry it was pulled from:
 * a different registry named explicitly is refused, because the token would go to the new host.
 * Credentials only go over https, or over plain http to a loopback address for local development.
 */
export function resolveRegistry(args: string[], lock: { registry: string } | null, env: Record<string, string | undefined> = process.env): string {
    const explicit = flag(args, '--registry') ?? env.HADARS_REGISTRY;
    let chosen: string;
    if (lock?.registry) {
        if (explicit !== undefined && new URL(explicit).origin !== new URL(lock.registry).origin) {
            throw new ApiError('registry_mismatch', `This project is pinned to ${new URL(lock.registry).origin}. To use ${new URL(explicit).origin}, remove hadars.lock and pull again.`);
        }
        chosen = lock.registry;
    } else {
        chosen = explicit ?? DEFAULT_REGISTRY;
    }
    const url = new URL(chosen);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
        throw new ApiError('insecure_registry', `Refusing to send credentials to ${url.origin}; use https.`);
    }
    return url.origin;
}

/** Commands this module handles; everything else belongs to the caller. */
export const REGISTRY_COMMANDS = ['login', 'ci-login', 'whoami', 'verify', 'publish', 'types', 'pull', 'outdated', 'versions', 'set', 'history', 'go-back', 'promote', 'preview', 'signing'] as const;

export const REGISTRY_USAGE = `Registry commands
  login [--device] [--no-browser]                    sign in; the token goes to stdout
  ci-login --team <id> --audience <a> [--job-token-env VAR]
  whoami [--json]
  publish --project <dir> --out <dir> [--to dev] [--dry-run] [--dev] [--manifest file --kind shell|module|library]
  types --project <dir> --out <dir>                  emit declarations for exposed namespaces
  pull [--env <name>] [--project <dir>] [--trusted-keys <file>]   verify and download a snapshot into hadars.lock
  outdated [--project <dir>]                         compare hadars.lock with its channel (read-only)
  verify [--trusted-keys <file>]                     check hadars.lock's channel signature
  versions <package> [--query text] [--kind k]
  set <env> <package>@<version> [<package>@<version> ...] [--expected-revision N]
  promote <from> <to> [--only a,b] [--expected-revision N]
  history <env> | go-back <env> <revision>
  preview create <name> --from <env> [--set package=#N]... [--ttl 7d]
  preview rebase <name> [--apply] | preview extend <name> [--ttl 7d]
  preview delete <name> | preview promote <name> <env>
  signing keygen --out <file>                        create an Ed25519 key for signed channel moves

Environment: HADARS_REGISTRY (or lock file / --registry), HADARS_TOKEN, HADARS_TEAM, HADARS_TRUSTED_KEYS`;

export interface RegistryIO {
    out: (line: string) => void;
    err: (line: string) => void;
    cwd: string;
}

const DAY = 24 * 60 * 60 * 1000;
const when = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : 'never');

function flag(args: string[], name: string): string | undefined {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
}
function flags(args: string[], name: string): string[] {
    return args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
}
/** Positional arguments after the command words, without flags and their values. */
function positional(args: string[], valued: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) { if (valued.includes(args[i])) i++; continue; }
        out.push(args[i]);
    }
    return out;
}

/** Lifetimes such as 15m, 12h or 90d. */
export function parseExpiry(text: string): number {
    const m = /^(\d+)([dhm])$/.exec(text);
    if (!m) throw new ApiError('invalid', `Cannot read "${text}" as a lifetime; use for example 15m, 12h or 90d.`);
    return Number(m[1]) * (m[2] === 'd' ? DAY : m[2] === 'h' ? 60 * 60 * 1000 : 60 * 1000);
}

/** Reads a CI identity token: an explicit variable, or the GitHub Actions request. */
async function jobTokenFromEnvironment(audience: string, variable?: string): Promise<string> {
    if (variable) {
        const value = process.env[variable];
        if (!value) throw new ApiError('no_job_token', `${variable} is empty.`);
        return value;
    }
    const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!url || !bearer) throw new ApiError('no_job_token', 'No CI identity found. In GitHub Actions grant `id-token: write`; elsewhere pass --job-token-env <VAR>.');
    const u = new URL(url); u.searchParams.set('audience', audience);
    const res = await fetch(u, { headers: { authorization: `Bearer ${bearer}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    const body = res.ok ? await res.json() as { value?: string } : null;
    if (!body?.value) throw new ApiError('no_job_token', `The CI identity provider did not issue a token (HTTP ${res.status}).`);
    return body.value;
}

async function jsonFile(file: string) {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch { throw new ApiError('invalid', `Cannot read JSON from ${file}`); }
}

/** Runs one registry command. Returns the exit code; throws ApiError for usage problems. */
export async function registryCommand(args: string[], io: RegistryIO): Promise<number> {
    const { out, err } = io;
    const command = args[0];
    const json = args.includes('--json');
    const project = path.resolve(io.cwd, flag(args, '--project') ?? '.');
    const lock = await readLock(project);

    if (command === 'publish' || command === 'types') return publishCommand(args, io, () => resolveRegistry(args, lock));

    if (command === 'verify') {
        const file = flag(args, '--trusted-keys') ?? process.env.HADARS_TRUSTED_KEYS;
        if (!file) { err('Pass --trusted-keys <file> or set HADARS_TRUSTED_KEYS.'); return 2; }
        if (!lock) { err('No hadars.lock here; run pull first.'); return 2; }
        // The lock is read from disk; verification needs no network and no registry token.
        out(`Verified: ${lock.channel} at ${lock.snapshotId} (version ${lock.channelVersion}) is signed by ${verifyLockSignature(lock, await readTrustedKeys(file))}.`);
        return 0;
    }
    if (command === 'signing') {
        if (args[1] !== 'keygen') throw new ApiError('invalid', 'Use signing keygen --out <file>');
        const dest = flag(args, '--out');
        if (!dest) { err('signing keygen needs --out <file> for the private key.'); return 2; }
        const k = generateSigningKey();
        try { await writeFile(dest, JSON.stringify({ keyId: k.keyId, publicKey: k.publicKey, privateKey: k.privateKey }) + '\n', { mode: 0o600, flag: 'wx' }); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new ApiError('exists', `${dest} already exists; refusing to overwrite a signing key.`); throw e; }
        out(k.publicKey);
        err(`Key ${k.keyId}. The private key is in ${dest} (mode 600); keep it off the registry and out of git.`);
        return 0;
    }

    const registry = resolveRegistry(args, lock);
    if (command === 'login') {
        const signedIn = await login({ registryUrl: registry, device: args.includes('--device'), noBrowser: args.includes('--no-browser'), tell: err });
        out(signedIn.access_token);
        return 0;
    }
    if (command === 'ci-login') {
        const t = flag(args, '--team') ?? process.env.HADARS_TEAM, audience = flag(args, '--audience');
        if (!t || !audience) { err('ci-login needs --team and --audience.'); return 2; }
        const jobToken = await jobTokenFromEnvironment(audience, flag(args, '--job-token-env'));
        const exchanged = await createClient({ registryUrl: registry, token: '' }).request('POST', `/v1/teams/${encodeURIComponent(t)}/token-exchange`, { token: jobToken });
        out(exchanged.token);
        err(`Token for team ${t}, role ${exchanged.info.role}, expires ${when(exchanged.expiresAt)}.`);
        return 0;
    }
    const token = process.env.HADARS_TOKEN;
    if (!token) { err('Set HADARS_TOKEN.'); return 2; }
    const client = createClient({ registryUrl: registry, token });
    const team = () => resolveTeam(client, flag(args, '--team') ?? process.env.HADARS_TEAM);
    const envArgs = () => positional(args.slice(1), ['--registry', '--team', '--project', '--only', '--expected-revision', '--from', '--set', '--ttl', '--query', '--kind']);
    const revision = () => {
        const value = flag(args, '--expected-revision');
        if (value !== undefined && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new ApiError('invalid', 'expected revision must be a nonnegative integer');
        return value === undefined ? undefined : Number(value);
    };
    const showEnvironment = (result: any) => {
        for (const a of result.advisories ?? []) err(`advisory: ${a.message}`);
        out(json ? JSON.stringify(result, null, 2) : result.current ? `${result.current.name} revision ${result.current.revision}: ${(result.current.changes ?? []).map((c: any) => c.name).join(', ') || 'no package changes'}` : 'Preview deleted.');
    };
    const envRoot = async () => `/v1/teams/${encodeURIComponent(await team())}`;

    if (command === 'whoami') {
        const me = await client.request('GET', '/v1/whoami');
        if (json) { out(JSON.stringify(me, null, 2)); return 0; }
        if (me.kind === 'service') {
            out(`service token "${me.token.name}" for team ${me.team.id} as ${me.role}, expires ${when(me.token.expiresAt)}`);
            out(`scopes: ${me.scopes ? JSON.stringify(me.scopes) : 'everything the role allows'}`);
        } else {
            out(`${me.user.email}${me.user.name ? ` (${me.user.name})` : ''}, token expires ${when(me.token.expiresAt)}`);
            for (const t of me.teams) out(`  ${t.id}  ${t.role}`);
        }
        return 0;
    }
    if (command === 'pull' || command === 'outdated') {
        // Checked before any request, so the token is not sent for a pull that cannot be verified.
        const trusted = flag(args, '--trusted-keys') ?? process.env.HADARS_TRUSTED_KEYS;
        if (command === 'pull' && !trusted && !args.includes('--allow-unsigned')) {
            throw new ApiError('invalid', 'pull needs trusted keys: pass --trusted-keys <file> or set HADARS_TRUSTED_KEYS. Use --allow-unsigned only for channels that are not signed.');
        }
        const t = await resolveTeam(client, flag(args, '--team') ?? process.env.HADARS_TEAM ?? lock?.team);
        if (command === 'pull') {
            const result = await pull({ client, registry, team: t, project, channel: flag(args, '--env') ?? flag(args, '--channel') ?? lock?.channel ?? 'stable',
                trustedKeys: trusted ? await readTrustedKeys(trusted) : undefined });
            out(json ? JSON.stringify(result, null, 2) : `Pinned ${result.lock.snapshotId} in hadars.lock (${result.downloaded} files downloaded).`);
        } else {
            const result = await outdated({ client, project, registry, team: t });
            out(json ? JSON.stringify(result, null, 2) : result.outdated ? `${result.currentSnapshot} -> ${result.availableSnapshot}\n${result.changes.map((c) => `${c.name}: ${c.current ?? '(new)'} -> ${c.available ?? '(removed)'}`).join('\n')}` : 'Up to date.');
        }
        return 0;
    }
    if (command === 'versions') {
        const [name] = envArgs();
        if (!name) throw new ApiError('invalid', 'versions needs a package name');
        const rows = await client.request('GET', `${await envRoot()}/versions/${encodeURIComponent(name)}?q=${encodeURIComponent(flag(args, '--query') ?? '')}${flag(args, '--kind') ? `&kind=${encodeURIComponent(flag(args, '--kind')!)}` : ''}`);
        out(json ? JSON.stringify(rows, null, 2) : rows.map((r: any) => `#${r.sequence} ${r.metadata?.branch ?? ''} ${r.metadata?.commit?.slice(0, 8) ?? ''} ${r.metadata?.message ?? ''} — ${r.metadata?.author ?? ''}`).join('\n') || 'No versions.');
        return 0;
    }
    if (command === 'set') {
        // One package keeps the single-cell route; several specs move together in one revision.
        const [env, ...specs] = envArgs();
        const usage = 'Use set <environment> <package>@<version> [<package>@<version> ...]';
        const parsed = specs.map((spec) => { const at = spec.lastIndexOf('@'); if (at < 1 || !spec.slice(at + 1)) throw new ApiError('invalid', usage); return { package: spec.slice(0, at), version: spec.slice(at + 1) }; });
        if (!env || parsed.length === 0) throw new ApiError('invalid', usage);
        const root = `${await envRoot()}/environments/${encodeURIComponent(env)}`;
        if (parsed.length === 1) showEnvironment(await client.request('POST', `${root}/set`, { ...parsed[0], kind: flag(args, '--kind'), expectedRevision: revision() }));
        else showEnvironment(await client.request('POST', `${root}/set-many`, { packages: parsed.map((p) => ({ ...p, kind: flag(args, '--kind') })), expectedRevision: revision() }));
        return 0;
    }
    if (command === 'history' || command === 'go-back') {
        const [env, target] = envArgs();
        if (!env) throw new ApiError('invalid', `${command} needs an environment`);
        const route = `${await envRoot()}/environments/${encodeURIComponent(env)}`;
        if (command === 'go-back') {
            if (!target || !/^[1-9]\d*$/.test(target) || !Number.isSafeInteger(Number(target))) throw new ApiError('invalid', 'go-back needs a positive revision number');
            showEnvironment(await client.request('POST', route + '/go-back', { revision: Number(target), expectedRevision: revision() }));
        } else {
            const rows = await client.request('GET', route + '/history');
            out(json ? JSON.stringify(rows, null, 2) : rows.map((r: any) => `revision ${r.revision}: ${r.changes.map((c: any) => c.name).join(', ') || 'no package changes'}${r.rows?.length ? ` (${r.rows.map((x: any) => `${x.name}${x.sequence === undefined ? '' : ` #${x.sequence}`}`).join(', ')})` : ''}`).join('\n'));
        }
        return 0;
    }
    if (command === 'promote') {
        const [from, to] = envArgs();
        if (!from || !to) throw new ApiError('invalid', 'Use promote <from> <to> [--only a,b]');
        showEnvironment(await client.request('POST', `${await envRoot()}/environments/${encodeURIComponent(to)}/promote`, { from, only: flag(args, '--only')?.split(','), expectedRevision: revision() }));
        return 0;
    }
    if (command === 'preview') {
        const [verb, name, to] = envArgs();
        if (!name || !['create', 'rebase', 'extend', 'delete', 'promote'].includes(verb)) throw new ApiError('invalid', 'Use preview create|rebase|extend|delete|promote <name>');
        const route = `${await envRoot()}/previews/${encodeURIComponent(name)}`;
        const ttlMs = flag(args, '--ttl') === undefined ? undefined : parseExpiry(flag(args, '--ttl')!);
        if (verb === 'create') {
            const from = flag(args, '--from');
            if (!from) throw new ApiError('invalid', 'preview create needs --from <environment>');
            const overrides = flags(args, '--set').map((v) => {
                const at = v.indexOf('=');
                if (at < 1 || !v.slice(at + 1)) throw new ApiError('invalid', 'Use --set package=#version');
                return { name: v.slice(0, at), version: v.slice(at + 1) };
            });
            showEnvironment(await client.request('POST', route, { from, overrides, ttlMs }));
        } else if (verb === 'rebase') {
            const diff = await client.request('POST', route + '/rebase', {});
            showEnvironment(diff);
            if (args.includes('--apply')) showEnvironment(await client.request('POST', route + '/rebase', { apply: true, expectedRevision: revision() ?? diff.current.revision, expectedBaseRevision: diff.current.preview.base.revision }));
            else err('Review these changes, then use preview rebase <name> --apply.');
        } else {
            if (verb === 'promote' && !to) throw new ApiError('invalid', 'preview promote needs a destination environment');
            showEnvironment(await client.request('POST', `${route}/${verb}`, { ttlMs, expectedRevision: revision(), to }));
        }
        return 0;
    }
    throw new ApiError('invalid', `Unknown registry command: ${command}`);
}

async function publishCommand(args: string[], io: RegistryIO, registryFor: () => string): Promise<number> {
    const { out, err } = io;
    const project = flag(args, '--project');
    const outDir = flag(args, '--out');
    if (!project || !outDir) { err(REGISTRY_USAGE); return 2; }
    const destination = flag(args, '--to');
    if (destination !== undefined && destination !== 'dev') throw new ApiError('invalid', 'publish --to accepts only dev; promote other environments explicitly');
    const typesOnly = args[0] === 'types';
    const dryRun = typesOnly || args.includes('--dry-run');
    const token = process.env.HADARS_TOKEN;
    const registry = dryRun ? undefined : registryFor();
    if (!dryRun && !token) { err('Set HADARS_TOKEN to publish.'); return 2; }

    const manifestFile = flag(args, '--manifest');
    let manifest;
    if (manifestFile) {
        if (typesOnly || args.includes('--emit-types')) throw new ApiError('invalid', 'Prebuilt manifests cannot emit types');
        try { manifest = readNativeManifest(path.resolve(manifestFile), path.resolve(outDir), flag(args, '--kind')); }
        catch (e) { throw new ApiError('invalid', (e as Error).message); }
    } else {
        if (flag(args, '--kind') && flag(args, '--kind') !== 'module') throw new ApiError('invalid', 'Shell/library publishing requires --manifest');
        const config = (await import(pathToFileURL(path.resolve(project, 'hadars.config.ts')).href)).default;
        const composition = config?.composition as ({ role: string } & ModuleConfig) | undefined;
        if (composition?.role !== 'module') {
            err(`${project}/hadars.config.ts has no composition: { role: 'module' }, nothing to publish.`);
            return 1;
        }
        if (typesOnly || args.includes('--emit-types')) {
            const api = await emitDeclarations(project, outDir, composition);
            if (typesOnly) { out(`Emitted declarations for ${Object.keys(api.exports).join(', ')} to ${path.resolve(outDir, 'types')}`); return 0; }
        }
        manifest = createBuildManifest({ outDir: path.resolve(outDir), projectDir: path.resolve(project), composition, flavour: args.includes('--dev') ? 'dev' : 'production' });
    }
    manifest.metadata = gitMetadata(path.resolve(project), Object.fromEntries(['commit', 'branch', 'author', 'message', 'label'].map((key) => [key, flag(args, `--${key}`)])));
    const issues = validateBuild(manifest);
    const policyFile = flag(args, '--policy');
    if (policyFile) issues.push(...validateBuildPolicy(manifest, await jsonFile(policyFile)));
    const bytes = manifest.files.reduce((n, f) => n + f.size, 0);
    const summary = `${manifest.name} ${manifest.buildId}: ${manifest.files.length} files, ${bytes} bytes`;
    for (const i of issues) err(`  invalid ${i.path}: ${i.message}`);
    if (issues.length) return 1;

    if (dryRun) {
        out(JSON.stringify(manifest, null, 2));
        err(`\n${summary}`);
        return 0;
    }
    try {
        const client: Client = createClient({ registryUrl: registry!, token: token! });
        const team = await resolveTeam(client, flag(args, '--team') ?? process.env.HADARS_TEAM);
        const result = await publishBuild({ client, team, outDir: path.resolve(outDir), manifest, progress: out });
        if (destination) {
            const moved = await client.request('POST', `/v1/teams/${encodeURIComponent(team)}/environments/dev/set`, { package: manifest.name, version: result.buildId, kind: manifest.kind });
            for (const advice of moved.advisories ?? []) err(`advisory: ${advice.message}`);
            err(`dev revision ${moved.current.revision}`);
        }
        out(result.status === 'exists'
            ? `${summary}: already published to ${team}, nothing to upload`
            : `${summary}: published to ${team} (${result.uploaded} uploaded, ${result.skipped} already stored)`);
        return 0;
    } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        err(`${summary}: ${e.code}: ${e.message}`);
        if (e.details) err(JSON.stringify(e.details, null, 2));
        return 1;
    }
}
