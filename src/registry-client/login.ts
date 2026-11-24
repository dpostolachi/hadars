import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from './client';

export interface LoginClientOptions {
    registryUrl: string;
    device?: boolean;
    /** Browser URLs and device instructions go here, never to token stdout. */
    tell?: (message: string) => void;
    openBrowser?: (url: string) => Promise<void>;
    noBrowser?: boolean;
    timeoutMs?: number;
    /** Injectable clock/wait for deterministic device-flow tests. */
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}
export interface LoginResult { access_token: string; token_type: string; expires_in: number }
function registryBase(value: string) {
    const u = new URL(value);
    if (u.username || u.password || u.pathname !== '/' || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname)))) throw new ApiError('invalid', 'Login registry must be an HTTPS origin (HTTP IP loopback is allowed for development).');
    return u.origin;
}
/** Returns a token once; does not write credentials to disk. */
export async function login(options: LoginClientOptions): Promise<LoginResult> {
    const base = registryBase(options.registryUrl);
    const tell = options.tell ?? console.error;
    const now = options.now ?? Date.now;
    const timeout = options.timeoutMs ?? 10 * 60_000;
    const deadline = now() + timeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const post = async (path: string, params: Record<string, string>) => {
        let response: Response;
        try {
            response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: controller.signal, redirect: 'error' });
        } catch { throw new ApiError(controller.signal.aborted ? 'expired_token' : 'unreachable', controller.signal.aborted ? 'Login timed out. Start again.' : 'Could not reach the registry.'); }
        let data: any;
        try { data = await response.json(); } catch { throw new ApiError('internal', 'Registry returned an invalid login response.'); }
        if (!response.ok) throw new ApiError(typeof data.error === 'string' ? data.error : 'internal', typeof data.error_description === 'string' ? data.error_description : 'Login failed.');
        return data;
    };
    const open = async (url: string) => {
        // Only the configured registry's pages may be opened.
        if (new URL(url).origin !== base) throw new ApiError('invalid', 'Registry returned a login page on another origin.');
        tell(`Open ${url}`);
        if (options.noBrowser || options.device) return;
        let abort!: () => void;
        try {
            await Promise.race([
                (options.openBrowser ?? openSystemBrowser)(url),
                new Promise<void>((_, reject) => {
                    abort = () => reject(new ApiError('expired_token', 'Login timed out. Start again.'));
                    controller.signal.addEventListener('abort', abort, { once: true });
                    if (controller.signal.aborted) abort();
                }),
            ]);
        } catch (err) {
            if (controller.signal.aborted) throw new ApiError('expired_token', 'Login timed out. Start again.');
            tell('Could not open a browser automatically. Open the URL above.');
        } finally { controller.signal.removeEventListener('abort', abort); }
    };
    const validate = (r: any): LoginResult => {
        if (typeof r.access_token !== 'string' || !/^hpu_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/.test(r.access_token) || r.token_type !== 'Bearer' || !Number.isFinite(r.expires_in) || r.expires_in <= 0) throw new ApiError('internal', 'Registry returned an invalid login token.');
        return r;
    };
    try {
        if (options.device) {
            const d = await post('/v1/auth/device', {});
            if (!/^[A-Za-z0-9_-]{43}$/.test(d.device_code) || typeof d.user_code !== 'string' || !Number.isFinite(d.interval) || d.interval < 1 || !Number.isFinite(d.expires_in) || d.expires_in <= 0) throw new ApiError('internal', 'Invalid device authorization response.');
            await open(d.verification_uri_complete ?? d.verification_uri);
            tell(`Confirm the terminal code: ${d.user_code}`);
            let interval = d.interval * 1000;
            const end = Math.min(deadline, now() + d.expires_in * 1000);
            while (now() + interval < end) {
                await (options.sleep ?? Bun.sleep)(interval);
                try { return validate(await post('/v1/auth/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: d.device_code })); }
                catch (err) {
                    if (!(err instanceof ApiError)) throw err;
                    if (err.code === 'slow_down') { interval += 5000; continue; }
                    if (err.code === 'authorization_pending') continue;
                    throw err;
                }
            }
            throw new ApiError('expired_token', 'Login timed out. Start again.');
        }
        const verifier = randomBytes(32).toString('base64url');
        const state = randomBytes(32).toString('base64url');
        let resolveCode!: (code: string) => void;
        let rejectCode!: (error: Error) => void;
        const callback = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
        // Avoid unhandled rejection if the registry request is still in flight at timeout.
        void callback.catch(() => {});
        let redirectUri = '';
        const server = Bun.serve({
            hostname: '127.0.0.1', port: 0,
            fetch(req) {
                const u = new URL(req.url);
                const params = u.searchParams;
                const invalid = () => new Response('Invalid login callback', { status: 400 });
                if (req.method !== 'GET' || u.origin + u.pathname !== redirectUri || params.getAll('state').length !== 1 || params.get('state') !== state) return invalid();
                if (params.getAll('error').length === 1 && !params.has('code') && params.get('error') === 'access_denied') {
                    rejectCode(new ApiError('access_denied', 'Sign-in was cancelled.'));
                    return new Response('Login cancelled. Return to your terminal.', { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
                }
                if (params.has('error') || params.getAll('code').length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(params.get('code') ?? '')) return invalid();
                resolveCode(params.get('code')!);
                return new Response('Signed in. Return to your terminal.', { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
            },
        });
        redirectUri = `http://127.0.0.1:${server.port}/callback`;
        const abort = () => rejectCode(new ApiError('expired_token', 'Login timed out. Start again.'));
        controller.signal.addEventListener('abort', abort, { once: true });
        try {
            const request = await post('/v1/auth/requests', { redirect_uri: redirectUri, state,
                code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
            await open(request.login_url);
            const code = await callback;
            return validate(await post('/v1/auth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }));
        } finally {
            controller.signal.removeEventListener('abort', abort);
            server.stop(true);
        }
    } finally { clearTimeout(timer); }
}
async function openSystemBrowser(url: string) {
    const command = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url] : ['xdg-open', url];
    const child = Bun.spawn(command, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    if (await child.exited !== 0) throw new Error('Browser launch failed');
}
