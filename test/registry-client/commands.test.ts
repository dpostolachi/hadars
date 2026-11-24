import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registryCommand, REGISTRY_COMMANDS, resolveRegistry, trustedKeysPath, TRUST_FILE } from '../../src/registry-client/commands';
import { ApiError } from '../../src/registry-client/client';

// A small registry stand-in: records requests and answers the few routes these commands use.
let server: ReturnType<typeof Bun.serve>;
let requests: Array<{ method: string; path: string; body: any }> = [];
const saved = { ...process.env };
let dir: string;
const io = () => ({ lines: [] as string[], errors: [] as string[] });

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'registry-cmd-'));
    requests = [];
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            const url = new URL(req.url);
            const body = req.method === 'POST' ? await req.json().catch(() => null) : null;
            requests.push({ method: req.method, path: url.pathname, body });
            if (url.pathname === '/v1/teams/acme/environments/dev/set-many') {
                return Response.json({ conflict: false, current: { name: 'dev', revision: 4, changes: [{ name: 'shell' }, { name: 'catalog' }] }, advisories: [] });
            }
            if (url.pathname === '/v1/teams/acme/versions/shell') {
                return Response.json([{ sequence: 2, metadata: { branch: 'main', commit: 'abcdef1234', message: 'release', author: 'dima' } }]);
            }
            return Response.json({ error: { code: 'not_found', message: 'no such route' } }, { status: 404 });
        },
    });
    process.env.HADARS_REGISTRY = `http://127.0.0.1:${server.port}`;
    process.env.HADARS_TOKEN = 'test-token';
    process.env.HADARS_TEAM = 'acme';
    delete process.env.HADARS_TRUSTED_KEYS;
});
afterEach(async () => {
    server.stop(true);
    process.env = { ...saved };
    await rm(dir, { recursive: true, force: true });
});

test('set with several packages makes one set-many call and reports one revision', async () => {
    const out = io();
    const code = await registryCommand(['set', 'dev', 'shell@2', 'catalog@3'], { out: (l) => out.lines.push(l), err: (l) => out.errors.push(l), cwd: dir });
    expect(code).toBe(0);
    expect(requests.map((r) => r.path)).toEqual(['/v1/teams/acme/environments/dev/set-many']);
    expect(requests[0].body.packages).toEqual([{ package: 'shell', version: '2', kind: undefined }, { package: 'catalog', version: '3', kind: undefined }]);
    expect(out.lines.join('\n')).toContain('dev revision 4: shell, catalog');
});

test('versions lists the package history', async () => {
    const out = io();
    await registryCommand(['versions', 'shell'], { out: (l) => out.lines.push(l), err: () => {}, cwd: dir });
    expect(out.lines[0]).toContain('#2 main abcdef12 release');
});

test('without a lock file or a named registry, the hosted registry is used', () => {
    expect(resolveRegistry([], null, {})).toBe('https://registry.hadars.xyz');
});

test('a registry named on the command line or in the environment overrides the default', () => {
    expect(resolveRegistry(['--registry', 'https://reg.example.com/x'], null, {})).toBe('https://reg.example.com');
    expect(resolveRegistry([], null, { HADARS_REGISTRY: 'https://self.example.org' })).toBe('https://self.example.org');
});

test('a lock file pins its registry; naming a different one is refused, the same one is accepted', () => {
    const lock = { registry: 'https://registry.hadars.xyz' };
    expect(resolveRegistry([], lock, {})).toBe('https://registry.hadars.xyz');
    expect(resolveRegistry(['--registry', 'https://registry.hadars.xyz'], lock, {})).toBe('https://registry.hadars.xyz');
    expect(() => resolveRegistry(['--registry', 'https://evil.example'], lock, {})).toThrow('pinned to https://registry.hadars.xyz');
    expect(() => resolveRegistry([], lock, { HADARS_REGISTRY: 'https://evil.example' })).toThrow('pinned');
});

test('credentials are refused over plain http, except to a loopback address', () => {
    expect(() => resolveRegistry(['--registry', 'http://registry.example.com'], null, {})).toThrow('use https');
    expect(resolveRegistry(['--registry', 'http://127.0.0.1:8080'], null, {})).toBe('http://127.0.0.1:8080');
});

test('pull refuses to run without trusted keys unless told explicitly', async () => {
    const out = io();
    await expect(registryCommand(['pull', '--env', 'stable'], { out: () => {}, err: (l) => out.errors.push(l), cwd: dir })).rejects.toThrow('needs trusted keys');
});

test('set rejects a spec without a version', async () => {
    await expect(registryCommand(['set', 'dev', 'shell'], { out: () => {}, err: () => {}, cwd: dir })).rejects.toThrow(ApiError);
});

test('verify without a lock file asks for pull first', async () => {
    const out = io();
    const code = await registryCommand(['verify', '--trusted-keys', join(dir, 'keys.json')], { out: () => {}, err: (l) => out.errors.push(l), cwd: dir });
    expect(code).toBe(2);
    expect(out.errors[0]).toContain('run pull first');
});

test('signing keygen writes a private key with mode 600 and never overwrites one', async () => {
    const file = join(dir, 'signing.json');
    expect(await registryCommand(['signing', 'keygen', '--out', file], { out: () => {}, err: () => {}, cwd: dir })).toBe(0);
    expect(((await stat(file)).mode & 0o777).toString(8)).toBe('600');
    expect(JSON.parse(await readFile(file, 'utf8')).privateKey).toBeString();
    await expect(registryCommand(['signing', 'keygen', '--out', file], { out: () => {}, err: () => {}, cwd: dir })).rejects.toThrow('already exists');
});

test('unknown commands fail clearly and the command list is exported', async () => {
    await expect(registryCommand(['frobnicate'], { out: () => {}, err: () => {}, cwd: dir })).rejects.toThrow('Unknown registry command');
    expect(REGISTRY_COMMANDS).toContain('set');
    expect(REGISTRY_COMMANDS).not.toContain('deploy');
});

test('signing keygen and verify do not need a registry', async () => {
    delete process.env.HADARS_REGISTRY;
    const file = join(dir, 'k.json');
    expect(await registryCommand(['signing', 'keygen', '--out', file], { out: () => {}, err: () => {}, cwd: dir })).toBe(0);
    const out = io();
    expect(await registryCommand(['verify', '--trusted-keys', file], { out: () => {}, err: (l) => out.errors.push(l), cwd: dir })).toBe(2);
    expect(out.errors[0]).toContain('run pull first');
});

test('trusted keys come from the flag, then the environment, then the committed trust file', async () => {
    const project = join(dir, 'app');
    await mkdir(project, { recursive: true });
    expect(trustedKeysPath([], project, {})).toBeUndefined();
    await writeFile(join(project, TRUST_FILE), '{"sk_test": "pk"}\n');
    expect(trustedKeysPath([], project, {})).toBe(join(project, TRUST_FILE));
    expect(trustedKeysPath([], project, { HADARS_TRUSTED_KEYS: '/env/keys.json' })).toBe('/env/keys.json');
    expect(trustedKeysPath(['--trusted-keys', '/flag/keys.json'], project, { HADARS_TRUSTED_KEYS: '/env/keys.json' })).toBe('/flag/keys.json');
});

test('set --sign-key dry-runs the move, then applies it with a signature over the proposal', async () => {
    const { generateSigningKey, channelMoveStatement, verifyStatement } = await import('../../src/registry-protocol');
    const key = generateSigningKey();
    const keyFile = join(dir, 'sign.json');
    await writeFile(keyFile, JSON.stringify({ keyId: key.keyId, publicKey: key.publicKey, privateKey: key.privateKey }));
    const seen: any[] = [];
    const mock = Bun.serve({ port: 0, async fetch(req) {
        const body: any = await req.json();
        seen.push(body);
        if (body.dryRun) return Response.json({ conflict: false, current: null, advisories: [], proposal: { snapshotId: 'snap_test', version: 3 } });
        return Response.json({ conflict: false, current: { name: 'dev', revision: 3, changes: [{ name: 'shell' }] }, advisories: [] });
    } });
    try {
        process.env.HADARS_REGISTRY = `http://127.0.0.1:${mock.port}`;
        const out = io();
        const code = await registryCommand(['set', 'dev', 'shell@2', '--sign-key', keyFile], { out: (l) => out.lines.push(l), err: () => {}, cwd: dir });
        expect(code).toBe(0);
        expect(seen.map((b) => !!b.dryRun)).toEqual([true, false]);
        const applied = seen[1];
        expect(applied.expectedRevision).toBe(2);
        expect(applied.signature.keyId).toBe(key.keyId);
        expect(verifyStatement(key.publicKey, channelMoveStatement('acme', 'dev', 3, 'snap_test'), applied.signature.signature)).toBe(true);
        expect(out.lines.join('\n')).toContain('dev revision 3');
    } finally {
        mock.stop(true);
    }
});
