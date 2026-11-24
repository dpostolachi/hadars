import { afterEach, expect, test } from 'bun:test';
import { createClient } from '../../src/registry-client/client';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const answers = (...replies: Array<number | Error>) => {
    const calls: string[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        calls.push(init?.method ?? 'GET');
        const next = replies.shift()!;
        if (next instanceof Error) throw next;
        return new Response(next === 200 ? '{"ok":true}' : '<!DOCTYPE html><title>504 Gateway Timeout</title>', { status: next });
    }) as unknown as typeof fetch;
    return calls;
};
const client = () => createClient({ registryUrl: 'https://registry.test', token: 't', retryDelaysMs: [0, 0, 0] });

test('a read rides out gateway timeouts and network blips', async () => {
    const calls = answers(504, new Error('socket closed'), 503, 200);
    expect(await client().request('GET', '/v1/whoami')).toEqual({ ok: true });
    expect(calls).toHaveLength(4);
});
test('a read that keeps failing reports the gateway in plain words, not its HTML', async () => {
    answers(504, 504, 504, 504);
    await expect(client().request('GET', '/v1/whoami')).rejects.toMatchObject({ code: 'unavailable', message: "The registry's gateway answered HTTP 504 for GET /v1/whoami; try again" });
});
test('a write is never repeated', async () => {
    const calls = answers(504, 200);
    await expect(client().request('POST', '/v1/teams/acme/deployments', { id: 'x' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(calls).toEqual(['POST']);
});

test('a request that the server redirects is refused, so the token never follows it', async () => {
    const other = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true }) });
    const registry = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 307, headers: { location: `http://127.0.0.1:${other.port}/v1/whoami` } }) });
    try {
        const client = createClient({ registryUrl: `http://127.0.0.1:${registry.port}`, token: 'secret-token', retryDelaysMs: [] });
        await expect(client.request('GET', '/v1/whoami')).rejects.toThrow();
    } finally { registry.stop(true); other.stop(true); }
});
