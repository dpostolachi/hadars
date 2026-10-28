/** Publication readiness uses a bounded, deterministic backoff; diagnostics never echo bodies. */
export function probeTimeout(value: unknown = 120): number {
    if (!/^[1-9]\d*$/.test(String(value)) || Number(value) > 600) throw new Error('Probe timeout must be an integer from 1 to 600 seconds');
    return Number(value);
}
export async function readinessProbe(send: typeof fetch, url: string, seconds: number, wait: (ms: number) => Promise<void>, expected?: { release: string; group: string; shell: string }, now: () => number = Date.now) {
    const start = now();
    let elapsed = 0, delay = 1000, last = 'network error', wrong = '', consecutive = 0;
    while (elapsed < seconds * 1000) {
        let identity = '';
        try {
            const response = await send(url, { redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, seconds * 1000 - elapsed))) });
            if (response.status !== 200) last = `HTTP ${response.status}`;
            else if (!expected) {
                // A provider's default page is not evidence of a published application.
                const body = await response.text();
                const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                if (text.length <= 200 && /^(?:(?:provider )?placeholder\b|default (?:response|script)\b)|script.*(?:not.*published|not.*ready)|welcome to bunny/i.test(text)) last = 'placeholder/unready body';
                else return undefined;
            } else {
                let data: any;
                try { data = await response.json(); } catch { /* Provider default HTML is unready. */ }
                if (!data || typeof data.release !== 'string' || typeof data.group !== 'string') last = 'placeholder/unready body (missing release/group JSON)';
                else if (data.release !== expected.release || data.group !== expected.group || data.shell !== expected.shell) {
                    // Compare opaque identities internally, but never print reflected values.
                    identity = JSON.stringify([data.release, data.group, data.shell]);
                    last = `wrong ${data.release !== expected.release ? 'release' : data.group !== expected.group ? 'group' : 'shell'} in JSON`;
                } else if (!forbidsReuse(response.headers.get('cache-control'))) last = 'response may be cached (expected no-store or no-cache)';
                else return undefined;
            }
        } catch { last = 'network error or request timeout'; }
        if (identity && identity === wrong) consecutive++; else consecutive = identity ? 1 : 0;
        wrong = identity;
        if (consecutive >= 3) return `${last} (3 consecutive identical wrong answers)`;
        elapsed = Math.max(elapsed, now() - start);
        const sleep = Math.min(delay, seconds * 1000 - elapsed);
        if (sleep <= 0) break;
        await wait(sleep);
        elapsed = Math.max(elapsed + sleep, now() - start);
        delay = Math.min(delay * 2, 10_000);
    }
    return `${last} (timed out after ${seconds}s)`;
}

/** The CDN layer may rewrite `no-store` to `no-cache` on script responses (measured on a real edge CDN); both forbid reuse without revalidation. */
export function forbidsReuse(value: string | null): boolean {
    const directives = (value ?? '').toLowerCase().split(',').map(d => d.trim());
    return directives.includes('no-store') || directives.includes('no-cache');
}
