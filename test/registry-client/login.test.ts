import { test, expect } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { login } from '../../src/registry-client/login';

test('browser sign-in: the code is exchanged with the PKCE verifier and the state is checked', async () => {
    const pending = new Map<string, { state: string; redirectUri: string; challenge: string }>();
    const codes = new Map<string, { challenge: string; redirectUri: string }>();
    const server = Bun.serve({ port: 0, async fetch(req) {
        const u = new URL(req.url), base = `http://127.0.0.1:${server.port}`;
        if (req.method === 'POST' && u.pathname === '/v1/auth/requests') {
            const body: any = await req.json();
            const request = randomBytes(8).toString('hex');
            pending.set(request, { state: body.state, redirectUri: body.redirect_uri, challenge: body.code_challenge });
            return Response.json({ login_url: `${base}/approve?request=${request}` });
        }
        if (u.pathname === '/approve') {
            // The approval page: the signed-in user approves, and the browser is sent back to the callback.
            const p = pending.get(u.searchParams.get('request') ?? '');
            if (!p) return new Response('unknown request', { status: 404 });
            const code = randomBytes(32).toString('base64url');
            codes.set(code, { challenge: p.challenge, redirectUri: p.redirectUri });
            return new Response(null, { status: 302, headers: { location: `${p.redirectUri}?code=${code}&state=${p.state}` } });
        }
        if (req.method === 'POST' && u.pathname === '/v1/auth/token') {
            const body: any = await req.json();
            const issued = codes.get(body.code);
            codes.delete(body.code);
            const matches = issued && issued.redirectUri === body.redirect_uri && createHash('sha256').update(body.code_verifier).digest('base64url') === issued.challenge;
            if (!matches) return Response.json({ error: 'invalid_grant', error_description: 'The code does not match.' }, { status: 400 });
            return Response.json({ access_token: `hpu_${'a'.repeat(16)}_${'B'.repeat(43)}`, token_type: 'Bearer', expires_in: 3600 });
        }
        return new Response('not found', { status: 404 });
    } });
    try {
        const told: string[] = [];
        const registryUrl = `http://127.0.0.1:${server.port}`;
        const promise = login({ registryUrl, noBrowser: true, tell: (line) => told.push(line) });
        // Play the browser: open the sign-in URL the CLI printed; the approval redirects to the loopback callback.
        const url = told.find((line) => line.startsWith('Open ')) ?? (await new Promise<string>((done) => { const timer = setInterval(() => { const found = told.find((l) => l.startsWith('Open ')); if (found) { clearInterval(timer); done(found); } }, 5); }));
        const loginUrl = url.slice('Open '.length);
        const approval = await fetch(loginUrl, { redirect: 'manual' });
        const callback = approval.headers.get('location')!;
        expect(callback).toContain('state=');
        await fetch(callback);
        const result = await promise;
        expect(result.access_token).toMatch(/^hpu_/);
        expect(result.token_type).toBe('Bearer');
    } finally {
        server.stop(true);
    }
});

test('a sign-in that arrives with the wrong state is not accepted', async () => {
    let redirectUri = '';
    const server = Bun.serve({ port: 0, async fetch(req) {
        const u = new URL(req.url), base = `http://127.0.0.1:${server.port}`;
        if (req.method === 'POST' && u.pathname === '/v1/auth/requests') {
            redirectUri = (await req.json() as any).redirect_uri;
            return Response.json({ login_url: `${base}/approve` });
        }
        return new Response('not found', { status: 404 });
    } });
    try {
        const told: string[] = [];
        const promise = login({ registryUrl: `http://127.0.0.1:${server.port}`, noBrowser: true, timeoutMs: 1500, tell: (line) => told.push(line) });
        await new Promise((done) => setTimeout(done, 50));
        // A request to the loopback callback with the wrong state must be refused, whatever code it carries.
        const forged = await fetch(`${redirectUri}?code=${'a'.repeat(43)}&state=wrong`);
        expect(forged.status).toBe(400);
        await expect(promise).rejects.toThrow();
    } finally {
        server.stop(true);
    }
});
