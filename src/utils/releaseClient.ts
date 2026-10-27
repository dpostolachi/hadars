/** Browser consistency assertion; never a routing address or credential. */
export function getReleaseRequestHeaders(): Record<string, string> {
    const release = (globalThis as any).__HADARS_RELEASE__?.release;
    return typeof release === 'string' && /^[0-9a-f]{16}$/.test(release)
        ? { 'x-hadars-release-selector': release } : {};
}

export const SplitReleaseMismatchError = /* @__PURE__ */ (() => class SplitReleaseMismatchError extends Error {
    constructor(public expected: string, public received: string, public group: string) {
        super(`SPLIT_RELEASE_MISMATCH: ${group} expected ${expected}, received ${received}`);
        this.name = 'SplitReleaseMismatchError';
    }
})();
export type SplitReleaseMismatchError = InstanceType<typeof SplitReleaseMismatchError>;

let memoryMarker: { target: string; timestamp: number } | undefined;
const failures = new Map<string, SplitReleaseMismatchError>();

/** Used by the split client compiler for live navigation data requests only. */
export async function releaseFetch(target: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(getReleaseRequestHeaders())) headers.set(key, value);
    const response = await fetch(target, { ...init, headers });
    if (response.status !== 409) return response;
    const body = await response.clone().json().catch(() => null);
    if (body?.error !== 'SPLIT_RELEASE_MISMATCH') return response;
    const error = new SplitReleaseMismatchError(body.expected, body.received, body.group);
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET') throw error;
    const url = new URL(target, globalThis.location.href).href;
    let marker = memoryMarker;
    try {
        const stored = JSON.parse(globalThis.sessionStorage.getItem('hadars-release-reload') ?? 'null');
        if (stored && typeof stored.target === 'string' && typeof stored.timestamp === 'number') marker = stored;
    } catch { /* Private mode: retain the in-memory guard. */ }
    const now = Date.now();
    if (marker?.target === url && now - marker.timestamp < 30_000) {
        if (!failures.has(url)) console.error('[hadars] Release changed during navigation; reload blocked for 30 seconds.', error);
        failures.set(url, error);
        throw error;
    }
    memoryMarker = { target: url, timestamp: now };
    try { globalThis.sessionStorage.setItem('hadars-release-reload', JSON.stringify(memoryMarker)); } catch {}
    globalThis.location.assign(url);
    // Keep the suspended render pending until the document is replaced.
    return new Promise<Response>(() => {});
}
