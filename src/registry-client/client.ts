/** An error answered by the registry, or a failure while talking to it. */
export class ApiError extends Error {
    constructor(readonly code: string, message: string, readonly details?: unknown) {
        super(message);
        this.name = 'ApiError';
    }
}

export interface ClientOptions {
    registryUrl: string;
    token: string;
    /** Waits before each retry of a read; the default rides out brief gateway timeouts at the registry's edge. */
    retryDelaysMs?: number[];
}

export interface Client {
    request<T = any>(method: string, path: string, body?: unknown): Promise<T>;
}

/** Opt-in timing of every registry call (names and numbers only), for finding slow steps in CI. */
const trace = (method: string, path: string, status: number | string, began: number) => {
    if (process.env.HADARS_PLATFORM_TRACE === '1') process.stderr.write(`trace +${Math.round(performance.now())}ms ${method} ${path.split('?')[0]} ${status} ${Math.round(performance.now() - began)}ms\n`);
};

export function createClient({ registryUrl, token, retryDelaysMs = [500, 1500, 4000] }: ClientOptions): Client {
    const base = registryUrl.replace(/\/$/, '');
    return {
        async request(method, path, body) {
            // Only reads are retried: a write may have landed before the gateway gave up, and its state checks would then refuse the repeat.
            const retries = method === 'GET' ? retryDelaysMs : [];
            let res: Response, text: string;
            for (let attempt = 0; ; attempt++) {
                const began = performance.now();
                try {
                    res = await fetch(`${base}${path}`, {
                        method,
                        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
                        body: body === undefined ? undefined : JSON.stringify(body),
                    });
                    text = await res.text();
                    trace(method, path, res.status, began);
                } catch (err) {
                    trace(method, path, 'failed', began);
                    if (attempt < retries.length) { await new Promise(done => setTimeout(done, retries[attempt])); continue; }
                    throw new ApiError('unreachable', `Could not reach the registry at ${base}: ${(err as Error).message}`);
                }
                if ([502, 503, 504].includes(res.status) && attempt < retries.length) { await new Promise(done => setTimeout(done, retries[attempt])); continue; }
                break;
            }
            let parsed: any;
            try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = [502, 503, 504].includes(res.status) ? { error: { code: 'unavailable', message: `The registry's gateway answered HTTP ${res.status} for ${method} ${path}; try again` } } : { error: { code: 'internal', message: text.slice(0, 200) } }; }
            if (!res.ok && parsed.conflict) throw new ApiError('conflict', `Environment changed; current revision ${parsed.current?.revision ?? 0}. Review the current table and retry.`, parsed);
            if (!res.ok) throw new ApiError(parsed.error?.code ?? String(res.status), parsed.error?.message ?? `HTTP ${res.status}`, parsed.error?.details);
            return parsed;
        },
    };
}

/**
 * Which team a command acts on: the explicit one, else the team a service token belongs to, else the only team a
 * person is in. Anything ambiguous is an error that says what to pass.
 */
export async function resolveTeam(client: Client, explicit?: string): Promise<string> {
    if (explicit) return explicit;
    const me = await client.request('GET', '/v1/whoami');
    if (me.kind === 'service') return me.team.id;
    if (me.teams.length === 1) return me.teams[0].id;
    if (me.teams.length === 0) throw new ApiError('invalid', 'You are not in any team yet. Create one with `team create <id>`.');
    throw new ApiError('invalid', `You are in several teams (${me.teams.map((t: { id: string }) => t.id).join(', ')}). Pass --team or set HADARS_PLATFORM_TEAM.`);
}
