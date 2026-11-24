// These helpers mutate Bunny resources when invoked. Callers validate all config before constructing the plan.
export class Bunny {
    constructor(private readonly key: string, private readonly send: typeof fetch = fetch, private readonly base = 'https://api.bunny.net') {}
    async request(method: string, path: string, body?: unknown): Promise<any> {
        const res = await this.send(this.base + path, { method, redirect: 'error', headers: { AccessKey: this.key, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`Bunny request failed (${res.status})`);
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    }
    async publish(id: string, code: string) {
        await this.request('POST', `/compute/script/${id}/code`, { Code: code });
        await this.request('POST', `/compute/script/${id}/publish`, { Note: 'release' });
    }
}
export async function storage(method: 'PUT' | 'DELETE' | 'GET', zone: string, key: string, path: string, body?: Uint8Array, send: typeof fetch = fetch) {
    if (!/^[a-z0-9-]+$/.test(zone) || path.split('/').some((p) => !p || p === '.' || p === '..')) throw new Error('Invalid storage path');
    const res = await send(`https://storage.bunnycdn.com/${zone}/${path.split('/').map(encodeURIComponent).join('/')}`, { method, redirect: 'error', headers: { AccessKey: key, 'content-type': 'application/octet-stream' }, body: body ? new Uint8Array(body).buffer : undefined, signal: AbortSignal.timeout(60_000) });
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`Storage request failed (${res.status})`);
    return res;
}
