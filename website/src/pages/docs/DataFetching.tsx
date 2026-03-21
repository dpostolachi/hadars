import React from 'react';
import { HadarsHead } from 'hadars';
import { useServerData } from 'hadars';
import Code from '../../components/Code';
import { Link } from 'react-router-dom';

const DemoHostnameRow: React.FC = () => {
    const val = useServerData<string>('df_hostname', async () => {
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
    const val = useServerData<number>('df_uptime', async () =>
        Math.round((globalThis as any).process?.uptime?.() ?? 0)
    );
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <span className="text-sm text-muted-foreground w-48 shrink-0">Process uptime</span>
            <span className="text-sm font-mono">{val !== undefined ? `${val} s` : '—'}</span>
        </div>
    );
};

const DemoEnvRow: React.FC = () => {
    const val = useServerData<string>('df_node_env', async () =>
        (globalThis as any).process?.env?.NODE_ENV ?? 'unknown'
    );
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <span className="text-sm text-muted-foreground w-48 shrink-0">NODE_ENV</span>
            <span className="text-sm font-mono">{val ?? '—'}</span>
        </div>
    );
};

const DataFetching: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>Data Fetching — hadars</title>
            <meta name="description" content="Fetch data on the server with getInitProps and useServerData. Batched requests, hydration cache, and React Query support." />
            <meta property="og:title" content="Data Fetching — hadars" />
            <meta property="og:description" content="Fetch data on the server with getInitProps and useServerData. Batched requests, hydration cache, and React Query support." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">Data Fetching</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            Fetch server-side data inside components without prop drilling, and hydrate the
            client with zero additional network requests.
        </p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">useServerData</h2>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useServerData(key, fn)</code> lets any component fetch async data during SSR.
                The framework's render loop awaits the promise and re-renders the tree until every
                value is resolved, then serialises the results into the page JSON.
                On the client, the pre-resolved value is read from the hydration cache — <code className="text-sm bg-muted px-1.5 py-0.5 rounded">fn</code>{' '}
                is <strong className="text-foreground">never called in the browser</strong>.
            </p>
            <Code>{`
import { useServerData } from 'hadars';

const UserCard = ({ userId }: { userId: string }) => {
    const user = useServerData(['user', userId], () => db.getUser(userId));
    if (!user) return null; // undefined on the first SSR pass(es) while pending
    return <p>{user.name}</p>;
};
            `}</Code>

            <h3 className="text-lg font-semibold mb-3 mt-6">key</h3>
            <p className="text-muted-foreground mb-4">
                A string or array of strings. Must be <strong className="text-foreground">stable and unique</strong> within the page —
                do not use <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Date.now()</code>, <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Math.random()</code>, or other values that
                change between render passes. Array keys are joined with <code className="text-sm bg-muted px-1.5 py-0.5 rounded">JSON.stringify</code>.
            </p>
            <Code>{`
// ✅ stable string key
const data = useServerData('current_user', () => db.getUser(id));

// ✅ array key — combines rel + dynamic values safely
const post = useServerData(['post', postId], () => db.getPost(postId));

// ❌ unstable — changes every render pass, will throw
const bad = useServerData(\`ts-\${Date.now()}\`, fn);
            `}</Code>

            <h3 className="text-lg font-semibold mb-3 mt-6">Client-side navigation</h3>
            <p className="text-muted-foreground">
                When a component mounts during client-side navigation and its key is not in the
                hydration cache, hadars fires a single <code className="text-sm bg-muted px-1.5 py-0.5 rounded">GET &lt;current-url&gt;</code> with{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Accept: application/json</code>. All <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useServerData</code> calls within
                the same React render are batched into one request and suspended until the server
                returns the JSON data map — regardless of how many keys are in the tree.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Synchronous data</h2>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">fn</code> can return a value synchronously. hadars detects non-Promise returns
                and stores them without suspending:
            </p>
            <Code>{`
// Fine — fn returns synchronously, no suspense needed
const config = useServerData('app_config', () => ({
    theme: 'dark',
    version: process.env.APP_VERSION,
}));
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">React Query / Suspense hooks</h2>
            <p className="text-muted-foreground mb-4">
                hadars's SSR renderer natively supports the Suspense protocol — when a component
                throws a Promise (as Suspense-compatible hooks do), the renderer awaits it and
                retries automatically.
            </p>
            <Code>{`
import { dehydrate, hydrate, QueryClient, useSuspenseQuery } from '@tanstack/react-query';

// getInitProps — create a per-request QueryClient
export const getInitProps = async (): Promise<Props> => ({
    rcClient: new QueryClient(),
    // ...
});

// getFinalProps — dehydrate the populated cache for the client
export const getFinalProps = async ({ rcClient, ...props }: Props) => {
    const cache = dehydrate(rcClient as QueryClient);
    return { ...props, cache };
};

// getClientProps — rehydrate on the client
export const getClientProps = async (props: PublicProps) => {
    const rcClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    hydrate(rcClient, props.cache);
    return { ...props, rcClient };
};

// Inside a component — useSuspenseQuery works SSR with no changes
const WeatherWidget: React.FC = () => {
    const { data } = useSuspenseQuery({
        queryKey: ['weather'],
        queryFn: () => fetch('/api/weather').then(r => r.json()),
        staleTime: Infinity,
    });
    return <p>{data.temperature} °C</p>;
};
            `}</Code>
            <p className="text-muted-foreground mt-4">
                The QueryClient cache is populated during SSR (slim-react awaits the thrown promises),
                dehydrated into the page JSON by <code className="text-sm bg-muted px-1.5 py-0.5 rounded">getFinalProps</code>, and rehydrated on the
                client by <code className="text-sm bg-muted px-1.5 py-0.5 rounded">getClientProps</code>. The hook returns synchronously on first client
                render — no second fetch.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Live demo</h2>
            <p className="text-muted-foreground mb-4">Three independent components each calling <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useServerData</code> with a different key:</p>
            <div className="rounded-xl divide-y overflow-hidden" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.2)", boxShadow: "0 0 24px oklch(0.68 0.28 285 / 0.06)" }}>
                <React.Suspense fallback={
                    <div className="flex items-center gap-4 px-4 py-3">
                        <span className="text-sm text-muted-foreground w-48 shrink-0">Loading…</span>
                        <span className="text-sm text-muted-foreground">fetching server data</span>
                    </div>
                }>
                    <DemoHostnameRow />
                    <DemoUptimeRow />
                    <DemoEnvRow />
                </React.Suspense>
            </div>
            <p className="text-xs text-muted-foreground mt-3 italic">
                Navigate to the <Link to="/data-demo" className="text-primary hover:underline">Data Fetch Demo</Link> page to
                see the batching behaviour — four keys resolved in a single request during client-side navigation.
            </p>
        </section>

        <footer className="mt-16 pt-8 text-center text-sm text-muted-foreground" style={{ borderTop: "1px solid oklch(0.68 0.28 285 / 0.15)" }}><p>hadars — MIT licence</p></footer>
    </>
);

export default DataFetching;
