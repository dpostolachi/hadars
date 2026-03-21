import React from 'react';
import { HadarsHead } from 'hadars';
import { useServerData } from 'hadars';

const DemoHostnameRow: React.FC = () => {
    const val = useServerData<string>('demo_hostname', async () => {
        const os = await import('node:os');
        return (os as any).hostname?.() ?? 'unknown';
    });
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <span className="text-sm text-muted-foreground w-48 shrink-0">Hostname</span>
            <span className="text-sm font-mono">{val ?? '—'}</span>
        </div>
    );
};

const DemoUptimeRow: React.FC = () => {
    const val = useServerData<number>('demo_uptime', async () =>
        Math.round((globalThis as any).process?.uptime?.() ?? 0)
    );
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <span className="text-sm text-muted-foreground w-48 shrink-0">Process uptime (s)</span>
            <span className="text-sm font-mono">{val !== undefined ? `${val} s` : '—'}</span>
        </div>
    );
};

const DemoEnvRow: React.FC = () => {
    const val = useServerData<string>('demo_node_env', async () =>
        (globalThis as any).process?.env?.NODE_ENV ?? 'unknown'
    );
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <span className="text-sm text-muted-foreground w-48 shrink-0">NODE_ENV</span>
            <span className="text-sm font-mono">{val ?? '—'}</span>
        </div>
    );
};

const DemoPlatformRow: React.FC = () => {
    const val = useServerData<string>('demo_platform', async () =>
        (globalThis as any).process?.platform ?? 'unknown'
    );
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <span className="text-sm text-muted-foreground w-48 shrink-0">Platform</span>
            <span className="text-sm font-mono">{val ?? '—'}</span>
        </div>
    );
};

// fn-stripping demo: the fetch URL and token below are server-only.
// The hadars rspack loader replaces `fn` with `()=>undefined` in the client
// bundle — so the secret endpoint and credentials never appear in browser JS.
// To verify after `hadars build`: search the .hadars/static/ JS files for the
// string "validate-token" — it will only be found in index.ssr.js (server),
// never in the client chunks.
const ServerOnlySecretRow: React.FC = () => {
    useServerData<{ user: string; role: string }>(
        'internal_auth_demo',
        async () => {
            // Everything inside this callback is stripped from the browser bundle.
            const TOKEN = 'Bearer ey_super_secret_internal_token';
            const url = 'https://internal-auth.internal/validate-token';
            const data = await fetch(url, { headers: { Authorization: TOKEN } })
                .then(r => r.json() as Promise<{ user: string; role: string }>)
                .catch(() => null);
            return data ?? { user: 'demo', role: 'viewer' };
        },
    );
    return null;
};

// ── fetch interceptor installed at module load time ───────────────────────────
// useServerData fires its fetch via queueMicrotask, which runs before any
// useEffect can install an interceptor. Installing here ensures we catch it.

let _fetchCount = 0;
let _lastFetchTime: string | null = null;
const _listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
    const _orig = window.fetch;
    window.fetch = (async (...args: Parameters<typeof fetch>) => {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
        const headers = args[1]?.headers as Record<string, string> | undefined;
        const accept = headers?.['Accept'] ?? (args[0] instanceof Request ? args[0].headers.get('Accept') : null);
        if (accept === 'application/json' && url.includes('/data-demo')) {
            _fetchCount += 1;
            _lastFetchTime = new Date().toLocaleTimeString();
            _listeners.forEach(fn => fn());
        }
        return _orig.apply(window, args);
    }) as typeof fetch;
}

// ─────────────────────────────────────────────────────────────────────────────

const DataDemo: React.FC = () => {
    const [fetchCount, setFetchCount] = React.useState(_fetchCount);
    const [lastFetchTime, setLastFetchTime] = React.useState(_lastFetchTime);

    React.useEffect(() => {
        // Sync in case the fetch fired (via microtask) before this effect ran
        setFetchCount(_fetchCount);
        setLastFetchTime(_lastFetchTime);

        const notify = () => {
            setFetchCount(_fetchCount);
            setLastFetchTime(_lastFetchTime);
        };
        _listeners.add(notify);
        return () => { _listeners.delete(notify); };
    }, []);

    return (
        <>
            <HadarsHead status={200}>
                <title>Data fetch demo — hadars</title>
                <meta name="description" content="Demo: four independent useServerData calls batched into a single request during client-side navigation." />
                <meta name="robots" content="noindex" />
            </HadarsHead>

            <h1 className="text-3xl font-bold mb-3 text-gradient">Batched useServerData</h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
                Four independent components each call <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useServerData</code> with a different key.
                During client-side navigation a single <code className="text-sm bg-muted px-1.5 py-0.5 rounded">GET /data-demo</code> with{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Accept: application/json</code> fetches all four values in one request.
            </p>

            <section className="mb-10">
                <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Server data (four keys, one request)</h2>
                <div className="rounded-xl divide-y overflow-hidden" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.2)", boxShadow: "0 0 24px oklch(0.68 0.28 285 / 0.06)" }}>
                    <React.Suspense fallback={
                        <div className="flex items-center gap-4 px-4 py-3">
                            <span className="text-sm text-muted-foreground w-48 shrink-0">Loading…</span>
                            <span className="text-sm text-muted-foreground">fetching all four keys in one batched request</span>
                        </div>
                    }>
                        <ServerOnlySecretRow />
                        <DemoHostnameRow />
                        <DemoUptimeRow />
                        <DemoEnvRow />
                        <DemoPlatformRow />
                    </React.Suspense>
                </div>

                <div className="rounded-xl divide-y overflow-hidden mt-4" style={{ background: 'oklch(0.08 0.025 280)', border: '1px solid oklch(0.68 0.28 285 / 0.2)', boxShadow: '0 0 24px oklch(0.68 0.28 285 / 0.06)' }}>
                    <div className="flex items-start gap-4 px-4 py-3">
                        <span className="text-sm text-muted-foreground w-48 shrink-0">Batched requests fired</span>
                        <span className={`text-sm font-mono ${fetchCount > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                            {fetchCount === 0
                                ? 'none yet — SSR-seeded, no fetch on first load'
                                : `${fetchCount} (last at ${lastFetchTime}) — one request per navigation ✓`}
                        </span>
                    </div>
                    <div className="flex items-start gap-4 px-4 py-3">
                        <span className="text-sm text-muted-foreground w-48 shrink-0">How to test</span>
                        <span className="text-sm text-muted-foreground">
                            Navigate away then back here via the sidebar. The counter increments by 1 each time — one batched request per navigation.
                        </span>
                    </div>
                </div>
            </section>

            <footer className="mt-16 pt-8 text-center text-sm text-muted-foreground" style={{ borderTop: '1px solid oklch(0.68 0.28 285 / 0.15)' }}><p>hadars — MIT licence</p></footer>
        </>
    );
};

export default DataDemo;
