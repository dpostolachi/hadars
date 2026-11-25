import { expect, test } from 'bun:test';
import { BunnyTarget, resolveRuntimeConfig, summarizeConfig } from '../../src/deploy/bunny';

const secret = 'mock-secret-never-print-8ce3';
test('config validates schema, identifiers, presence, duplicates and limits without echoing values', () => {
    for (const input of [null, [], { other: secret }, { variables: { 'bad-name': secret } }, { variables: { OK: 4 } },
        { variables: { OK: secret.repeat(30) } }, { secrets: { TOKEN: secret } }, { secrets: { TOKEN: { env: 'TOKEN', value: secret } } },
        { secrets: { TOKEN: { env: 'ABSENT' } } }, { required: ['MISSING'] }, { required: [3] },
        { variables: { TOKEN: 'x' }, secrets: { TOKEN: { env: 'TOKEN' } } }, { secrets: { TOKEN: { env: 'LONG' } } },
        { variables: { ['A'.repeat(257)]: 'x' } }]) {
        let message = '';
        try { resolveRuntimeConfig(input, [], { TOKEN: secret, LONG: secret.repeat(30) }); } catch (e) { message = (e as Error).message; }
        expect(message).not.toBe(''); expect(message).not.toContain(secret);
    }
    const config = resolveRuntimeConfig({ variables: { URL: 'file' }, secrets: { TOKEN: { env: 'TOKEN' } }, required: ['URL', 'TOKEN'] }, ['URL=https://local.invalid/a=b'], { TOKEN: secret });
    expect(config.variables.URL).toBe('https://local.invalid/a=b');
    expect(config.secrets.TOKEN).toBe(secret);
    const summary = summarizeConfig(config);
    expect(JSON.stringify(summary)).not.toContain(secret);
    expect(summary.digest).toBe(summarizeConfig({ ...config, secrets: { TOKEN: 'rotated' } }).digest);
    expect(summary.digest).not.toBe(summarizeConfig({ ...config, variables: { URL: 'changed' } }).digest);
    expect(() => resolveRuntimeConfig({}, ['TOKEN'])).toThrow('--var');
    expect(() => resolveRuntimeConfig({}, ['BAD-NAME=hidden'])).toThrow('name');
});

test('revision config precedes publish/verify, drift refuses publication, rollback never writes config', async () => {
    for (const mode of ['ok', 'drift', 'secret-error'] as const) {
        const calls: string[] = [], variables: any[] = [], secrets: any[] = [];
        const config = resolveRuntimeConfig({ variables: { URL: 'https://local.invalid' }, secrets: { TOKEN: { env: 'TOKEN' } }, required: ['TOKEN', 'URL'] }, [], { TOKEN: secret });
        const client = {
            async request(method: string, path: string, body?: any): Promise<any> {
                calls.push(`${method} ${path}`);
                if (path === '/pullzone') return [];
                if (path.split('?')[0] === '/compute/script') return method === 'GET' ? [] : { Id: 9 };
                if (method === 'PUT' && path.endsWith('/variables')) { variables.push({ ...body, DefaultValue: mode === 'drift' ? 'wrong' : body.DefaultValue }); return {}; }
                if (method === 'PUT' && path.endsWith('/secrets')) {
                    if (mode === 'secret-error') throw new Error(`Provider reflected ${secret}`);
                    secrets.push({ Name: body.Name }); return {};
                }
                if (path.endsWith('/secrets')) return { Secrets: secrets };
                return { DefaultHostname: 'demo.bunny.run', EdgeScriptVariables: variables };
            },
            async publish() { calls.push('publish'); },
        };
        const send = (async (_input: RequestInfo | URL) => { calls.push('smoke'); return new Response('ok'); }) as typeof fetch;
        const target = new BunnyTarget({ key: 'mock', publicZoneId: '1', storageZone: 'mock', storageKey: 'mock' }, send, client);
        const revision = { project: 'demo', environment: 'dev', revision: 1, artifact: { entry: 'bunny.mjs', files: [{ path: 'bunny.mjs', bytes: Buffer.from('script') }] } };
        const plan = target.plan(revision, config);
        expect(JSON.stringify(plan)).not.toContain(secret);
        if (mode !== 'ok') {
            let error = '';
            try { await target.stage(plan, config); } catch (e) { error = String(e); }
            expect(error).not.toBe(''); expect(error).not.toContain(secret); expect(calls).not.toContain('publish');
            continue;
        }
        const staged = await target.stage(plan, config);
        await target.verify(staged, plan.configSummary);
        expect(calls.indexOf('PUT /compute/script/9/secrets')).toBeLessThan(calls.indexOf('publish'));
        expect(calls.indexOf('PUT /compute/script/9/variables')).toBeLessThan(calls.indexOf('publish'));
        expect(calls.indexOf('publish')).toBeLessThan(calls.indexOf('smoke'));
        variables[0].DefaultValue = 'manual drift';
        expect((await target.verify(staged, plan.configSummary)).ok).toBe(false);
        const before = JSON.stringify({ variables, secrets }); const count = calls.length;
        await target.rollback({ ...staged, scriptId: '8' });
        expect(calls.slice(count)).toEqual(['POST /pullzone/1', 'POST /pullzone/1/purgeCache']);
        expect(JSON.stringify({ variables, secrets })).toBe(before);
        await expect(target.stage(plan)).rejects.toThrow('differs from plan');
    }
});

test('incomplete code readback refuses existing immutable names', async () => {
    const calls: string[] = [];
    const target = new BunnyTarget({ key: 'mock', publicZoneId: '1', storageZone: 'mock', storageKey: 'mock' }, fetch, {
        async request(method, path) { calls.push(`${method} ${path}`); return [{ Id: 1, Name: 'demo-dev-r1' }]; },
        async publish() { throw new Error('must not publish'); },
    });
    const revision = { project: 'demo', environment: 'dev', revision: 1, artifact: { entry: 'bunny.mjs', files: [{ path: 'bunny.mjs', bytes: Buffer.from('same artifact') }] } };
    for (const value of ['old', 'changed']) {
        const config = resolveRuntimeConfig({ variables: { URL: value } });
        await expect(target.stage(target.plan(revision, config), config)).rejects.toThrow('immutable script');
    }
    expect(calls).toEqual(['GET /compute/script?page=1&perPage=100', 'GET /compute/script/1/code', 'GET /compute/script?page=1&perPage=100', 'GET /compute/script/1/code']);
});

test('readback accepts spec-nullable empty collections but refuses absent list fields', async () => {
    for (const missing of [false, true]) {
        const target = new BunnyTarget({ key: 'mock', publicZoneId: '1', storageZone: 'mock', storageKey: 'mock' }, fetch, {
            async request(_method, path) { return missing ? {} : path.endsWith('/secrets') ? { Secrets: null } : { EdgeScriptVariables: null }; },
            async publish() {},
        });
        const summary = summarizeConfig(resolveRuntimeConfig({}));
        if (missing) await expect(target.verifyConfig('1', summary)).rejects.toThrow('incomplete provider');
        else await target.verifyConfig('1', summary);
    }
});
