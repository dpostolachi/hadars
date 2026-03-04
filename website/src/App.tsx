import React from 'react';
import './index.css';
import { HadarsContext, HadarsHead, useServerData, loadModule, type HadarsApp, type HadarsRequest } from 'hadars';
import { dehydrate, hydrate, QueryClient, QueryClientProvider, useSuspenseQuery, type DehydratedState } from '@tanstack/react-query'
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-bash';

// loadModule('./LazyPanel') is transformed by the hadars rspack loader:
//   browser → import('./LazyPanel')            (separate JS chunk, code-split)
//   server  → Promise.resolve(require('./LazyPanel'))  (statically bundled)
const LazyPanel = React.lazy(() => loadModule<{ default: React.FC }>('./LazyPanel'));

interface PageProps {
    serverTime: string;
    bunVersion: string;
    rcClient?: QueryClient;
    cache?: DehydratedState;
}

// ── tiny shared components ────────────────────────────────────────────────────

type CodeLang = 'tsx' | 'typescript' | 'bash';

const Code: React.FC<{ children: string; lang?: CodeLang }> = ({ children, lang = 'tsx' }) => {
    const grammar = Prism.languages[lang] ?? Prism.languages.plaintext;
    const highlighted = Prism.highlight(children.trim(), grammar, lang);
    return (
        <pre className={`code-block language-${lang}`}>
            <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
    );
};

const Pill: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className="pill">{children}</span>
);

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
    <section id={id} className="doc-section">
        <h2>{title}</h2>
        {children}
    </section>
);

const FeatureCard: React.FC<{ icon: string; title: string; desc: string }> = ({ icon, title, desc }) => (
    <div className="feature-card">
        <span className="feature-icon">{icon}</span>
        <h3>{title}</h3>
        <p>{desc}</p>
    </div>
);

const SuspenseQueryRow: React.FC = () => {
    // useServerData catches the thrown promise from useSuspenseQuery,
    // awaits it, then re-renders. On the second pass useSuspenseQuery
    // returns synchronously and the value is immediately available.
    const weatherData = useServerData(['data-fetch2'], () => useSuspenseQuery({
        queryKey: ['data-fetch'],
        queryFn: async () => {
            const res = await fetch('http://localhost:9090/api/data');
            return res.json();
        },
    }) ) || {};

    const { data } = weatherData as any;

    return (
        <div className="demo-row">
            <span className="demo-label">useServerData + Suspense hook</span>
            <span className="demo-value">{data ? JSON.stringify(data) : '—'}</span>
        </div>
    );
};

// ── useServerData demo component ──────────────────────────────────────────────

interface ProcessStats {
    pid: number;
    mem: number; // RSS in MB
}

// Demonstrates useServerData: fetches async data inside a component during SSR.
// The framework re-renders until the promise resolves, then serialises the value
// for the client — no fetch is issued in the browser.
const ServerStatsRow: React.FC = () => {
    const stats = useServerData<ProcessStats>('server_stats', async () => {
        const res = {
            pid: process.pid,
            mem: Math.round(process.memoryUsage().rss / 1024 / 1024),
        };
        return res;
    });

    return (
        <div className="demo-row">
            <span className="demo-label">useServerData (pid / mem)</span>
            <span className="demo-value">
                {stats ? `pid ${stats.pid} · ${stats.mem} MB RSS` : '—'}
            </span>
        </div>
    );
};

// ── /cache-test page ──────────────────────────────────────────────────────────

// This page is served with a 30-second SSR cache (see hadars.config.ts).
// The SSR timestamp is frozen while cached; the client clock ticks normally.
// When they diverge it proves the cached HTML is being served.
const CacheTestPage: React.FC<{ serverTime: string; context: any }> = ({ serverTime, context }) => {
    const [clientTime, setClientTime] = React.useState('');

    React.useEffect(() => {
        const fmt = () => new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
        setClientTime(fmt());
        const id = setInterval(() => setClientTime(fmt()), 1000);
        return () => clearInterval(id);
    }, []);

    const isCached = clientTime !== '' && clientTime !== serverTime;

    return (
        <HadarsContext context={context}>
            <HadarsHead status={200}>
                <title>Cache test — hadars</title>
            </HadarsHead>
            <div className="layout">
                <nav className="navbar">
                    <a className="navbar-brand" href="/">hadars</a>
                </nav>
                <header className="hero" style={{ paddingBottom: '2rem' }}>
                    <h1>SSR cache test</h1>
                    <p className="hero-sub">
                        This page has a <strong>30-second TTL</strong> configured in{' '}
                        <code>hadars.config.ts</code>. Reload within 30 s — the SSR timestamp
                        stays frozen while the client clock keeps ticking.
                    </p>
                </header>
                <section className="doc-section">
                    <div className="demo-box">
                        <div className="demo-row">
                            <span className="demo-label">SSR timestamp <em>(frozen when cached)</em></span>
                            <span className="demo-value">{serverTime}</span>
                        </div>
                        <div className="demo-row">
                            <span className="demo-label">Client clock <em>(always live)</em></span>
                            <span className="demo-value">{clientTime || '—'}</span>
                        </div>
                        <div className="demo-row">
                            <span className="demo-label">Cache status</span>
                            <span className="demo-value" style={{ color: isCached ? '#4ec9b0' : '#9cdcfe' }}>
                                {clientTime === '' ? '—' : isCached
                                    ? 'HIT — serving cached HTML (30 s TTL)'
                                    : 'MISS — freshly rendered'}
                            </span>
                        </div>
                    </div>
                </section>
                <footer className="footer"><p>hadars — MIT licence</p></footer>
            </div>
        </HadarsContext>
    );
};

// ── page ─────────────────────────────────────────────────────────────────────

const Home: HadarsApp<PageProps> = ({ serverTime, bunVersion, location, context, rcClient }) => {
    const [count, setCount] = React.useState(0);

    return (
        <HadarsContext context={context}>
            <QueryClientProvider client={rcClient!}>
            <HadarsHead status={200}>
                <title>hadars — SSR for React</title>
                <meta id="desc" name="description" content="Fast, simple server-side rendering for React using Bun and rspack." />
            </HadarsHead>

            <div className="layout">

                {/* ── nav ── */}
                <nav className="navbar">
                    <span className="navbar-brand">hadars</span>
                    <div className="navbar-links">
                        <a href="#quickstart">Quick start</a>
                        <a href="#concepts">Concepts</a>
                        <a href="#api">API</a>
                        <a href="#demo">Demo</a>
                    </div>
                </nav>

                {/* ── hero ── */}
                <header className="hero">
                    <div className="hero-badges">
                        <Pill>SSR</Pill>
                        <Pill>HMR</Pill>
                        <Pill>TypeScript</Pill>
                        <Pill>React 19</Pill>
                        <Pill>Bun</Pill>
                        <Pill>Node.js</Pill>
                        <Pill>Deno</Pill>
                        <Pill>rspack</Pill>
                    </div>
                    <h1>Server-side React,<br />without the ceremony.</h1>
                    <p className="hero-sub">
                        hadars is a minimal SSR framework for React built on rspack.
                        Runs on Bun, Node.js, and Deno — export a component, export <code>getInitProps</code>, run one command.
                    </p>
                    <div className="hero-cta">
                        <Code lang="bash">{`hadars dev`}</Code>
                    </div>
                </header>

                {/* ── features ── */}
                <section className="features-grid">
                    <FeatureCard icon="⚡" title="React Fast Refresh" desc="Full HMR via rspack-dev-server. Module-level patches, no full-page reloads." />
                    <FeatureCard icon="🖥️" title="True SSR" desc="Components render on the server with your data, then hydrate on the client." />
                    <FeatureCard icon="✂️" title="Code splitting" desc="loadModule('./Comp') splits on the browser and bundles statically on the server." />
                    <FeatureCard icon="🦴" title="Head management" desc="HadarsHead controls title, meta, link, and script tags on both server and client." />
                    <FeatureCard icon="🌐" title="Cross-runtime" desc="Runs on Bun, Node.js, and Deno. No Bun-specific APIs — uses the standard Fetch API throughout." />
                    <FeatureCard icon="⚙️" title="Multi-core production" desc="Set workers: os.cpus().length to fork a process per CPU core via node:cluster. Client and SSR bundles build in parallel too." />
                </section>

                {/* ── quick start ── */}
                <Section id="quickstart" title="Quick start">
                    <p>Add hadars as a dependency, create a config, write a page component.</p>

                    <h3>1 — hadars.config.ts</h3>
                    <Code lang="typescript">{`
import os from 'os';
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    port: 3000,
    // Fork one worker per CPU core in production (Node.js only).
    workers: os.cpus().length,
};

export default config;
                    `}</Code>

                    <h3>2 — src/App.tsx</h3>
                    <Code>{`
import React from 'react';
import { HadarsContext, HadarsHead, type HadarsApp, type HadarsRequest } from 'hadars';

interface Props {
    user: { name: string };
}

const App: HadarsApp<Props> = ({ user, location, context }) => (
    <HadarsContext context={context}>
        <HadarsHead status={200}>
            <title>Hello {user.name}</title>
        </HadarsHead>
        <h1>Hello, {user.name}!</h1>
        <p>You are at {location}</p>
    </HadarsContext>
);

// Runs on the server for every request.
export const getInitProps = async (req: HadarsRequest): Promise<Props> => {
    const user = await db.getUser(req.cookies.session);
    return { user };
};

export default App;
                    `}</Code>

                    <h3>3 — run it</h3>
                    <Code lang="bash">{`
# development server with React Fast Refresh HMR
hadars dev

# production build — client + SSR compiled in parallel
hadars build

# serve the production build
hadars run           # multi-core when workers > 1
                    `}</Code>
                </Section>

                {/* ── concepts ── */}
                <Section id="concepts" title="Core concepts">

                    <h3>Data lifecycle</h3>
                    <p>Each request goes through up to four optional hooks before a response is sent:</p>
                    <div className="lifecycle">
                        <div className="lifecycle-step">
                            <span className="step-label">server</span>
                            <strong>getInitProps</strong>
                            <span>Fetch server-side data. Has access to the full <code>HadarsRequest</code> (cookies, pathname, search).</span>
                        </div>
                        <div className="lifecycle-arrow">→</div>
                        <div className="lifecycle-step">
                            <span className="step-label">server</span>
                            <strong>getAfterRenderProps</strong>
                            <span>Inspect the rendered HTML string to derive additional props (e.g. extract inline styles for critical CSS).</span>
                        </div>
                        <div className="lifecycle-arrow">→</div>
                        <div className="lifecycle-step">
                            <span className="step-label">server</span>
                            <strong>getFinalProps</strong>
                            <span>Strip server-only data before props are serialised into the page JSON for the client.</span>
                        </div>
                        <div className="lifecycle-arrow">→</div>
                        <div className="lifecycle-step">
                            <span className="step-label">client</span>
                            <strong>getClientProps</strong>
                            <span>Runs in the browser after the page loads. Enrich props with client-only data (localStorage, device APIs).</span>
                        </div>
                    </div>

                    <h3>Head management</h3>
                    <p>
                        Wrap your app in <code>HadarsContext</code> and place <code>HadarsHead</code> anywhere in the tree.
                        On the server the context is populated by mutation during render.
                        On the client the same API writes directly to <code>document.head</code>.
                    </p>
                    <Code>{`
<HadarsHead status={200}>
    <title>My Page</title>
    <meta id="og-title" property="og:title" content="My Page" />
    <link id="canonical" rel="canonical" href="https://example.com/my-page" />
</HadarsHead>
                    `}</Code>

                    <h3>Code splitting with loadModule</h3>
                    <p>
                        <code>loadModule('./path')</code> is transformed at compile time by the hadars rspack loader.
                        In the browser it becomes a dynamic <code>import()</code>, giving you automatic code splitting.
                        On the server it becomes <code>Promise.resolve(require('./path'))</code>, so the module is bundled statically.
                    </p>
                    <Code>{`
import React from 'react';
import { loadModule } from 'hadars';

// The HeavyChart chunk is only downloaded when this component mounts.
const HeavyChart = React.lazy(() => loadModule('./HeavyChart'));

export default function Dashboard() {
    return (
        <React.Suspense fallback={<p>Loading chart…</p>}>
            <HeavyChart />
        </React.Suspense>
    );
}
                    `}</Code>
                    <h3>Async data with useServerData</h3>
                    <p>
                        <code>useServerData(key, fn)</code> lets any component fetch async data
                        during SSR without plumbing it through <code>getInitProps</code>.
                        The framework re-renders the tree until every promise resolves, then
                        serialises the results into the page so the client hydrates with the
                        same values — no second fetch in the browser.
                    </p>
                    <Code>{`
import { useServerData } from 'hadars';

// Inside any component wrapped by HadarsContext:
const user = useServerData('current_user', () => db.getUser(id));
// Returns undefined on the first pass(es) while in-flight.
// Returns the resolved value on the final SSR pass.
// On the client, returns the server value immediately (no re-fetch).
if (!user) return null;
return <h1>Hello, {user.name}</h1>;

// Use an array key when the key depends on dynamic values:
const post = useServerData(['post', postId], () => db.getPost(postId));
                    `}</Code>

                    <h3>Suspense-compatible hooks (e.g. React Query)</h3>
                    <p>
                        <code>useServerData</code> also supports Suspense-compatible hooks like{' '}
                        <code>useSuspenseQuery</code> from React Query. When the inner hook throws
                        a promise (the Suspense protocol), hadars intercepts it, awaits it, then
                        re-renders — at which point the hook returns its value synchronously.
                        The result is <strong>not</strong> serialised into the page; instead, the
                        Suspense library handles its own cache hydration (via <code>dehydrate</code>{' '}
                        /<code> hydrate</code> in <code>getFinalProps</code> / <code>getClientProps</code>).
                    </p>
                    <Code>{`
// 1. Wrap your app in a QueryClientProvider, passing a per-request QueryClient.
//    Create the client in getInitProps and destroy it in getFinalProps.

export const getInitProps = async (): Promise<Props> => ({
    ...,
    rcClient: new QueryClient(),
});

export const getFinalProps = async ({ rcClient, ...props }) => {
    const cache = dehydrate(rcClient);
    rcClient.clear();   // cancel GC timers
    rcClient.unmount(); // unregister focus/online listeners
    return { ...props, cache };
};

// 2. Rehydrate on the client.
export const getClientProps = async (props) => {
    const rcClient = new QueryClient();
    hydrate(rcClient, props.cache);
    return { ...props, rcClient };
};

// 3. Wrap the app tree in QueryClientProvider.
const App: HadarsApp<Props> = ({ context, rcClient }) => (
    <HadarsContext context={context}>
        <QueryClientProvider client={rcClient}>
            <Page />
        </QueryClientProvider>
    </HadarsContext>
);

// 4. Use useSuspenseQuery inside any component.
//    useServerData wraps the hook so hadars's render loop awaits it SSR-side.
//    On the client the hook reads directly from the rehydrated QueryClient cache.
const Page: React.FC = () => {
    const result = useServerData(['posts'], () =>
        useSuspenseQuery({ queryKey: ['posts'], queryFn: () => fetch('/api/posts').then(r => r.json()) })
    ) ?? {};
    const { data } = result as any;
    return <ul>{data?.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
};
                    `}</Code>
                </Section>

                {/* ── api ── */}
                <Section id="api" title="API reference">

                    <h3>HadarsOptions (hadars.config.ts)</h3>
                    <div className="api-table">
                        <div className="api-row api-header">
                            <span>Option</span><span>Type</span><span>Description</span>
                        </div>
                        <div className="api-row"><code>entry</code><span>string</span><span>Path to your page component (required).</span></div>
                        <div className="api-row"><code>port</code><span>number</span><span>HTTP port. Default: 9090.</span></div>
                        <div className="api-row"><code>hmrPort</code><span>number</span><span>Port for the rspack HMR dev server. Default: port + 1.</span></div>
                        <div className="api-row"><code>baseURL</code><span>string</span><span>Public base path, e.g. <code>"/app"</code>.</span></div>
                        <div className="api-row"><code>workers</code><span>number</span><span>Worker processes to fork in <code>run()</code> mode (Node.js only). Default: 1. Use <code>os.cpus().length</code> to saturate all cores.</span></div>
                        <div className="api-row"><code>proxy</code><span>Record / fn</span><span>Path-prefix proxy rules or a custom async function.</span></div>
                        <div className="api-row"><code>proxyCORS</code><span>boolean</span><span>Inject CORS headers on proxied responses.</span></div>
                        <div className="api-row"><code>define</code><span>Record</span><span>Compile-time constants, passed to rspack's DefinePlugin.</span></div>
                        <div className="api-row"><code>swcPlugins</code><span>array</span><span>Extra SWC plugins (e.g. Relay compiler).</span></div>
                        <div className="api-row"><code>fetch</code><span>function</span><span>Custom fetch handler. Return a <code>Response</code> to short-circuit SSR.</span></div>
                        <div className="api-row"><code>websocket</code><span>object</span><span>WebSocket handler (Bun only), forwarded to <code>Bun.serve</code>.</span></div>
                        <div className="api-row"><code>wsPath</code><span>string</span><span>Path that triggers WebSocket upgrade. Default: <code>"/ws"</code>.</span></div>
                    </div>

                    <h3>HadarsRequest</h3>
                    <p>Extends the standard <code>Request</code> with:</p>
                    <Code lang="typescript">{`
interface HadarsRequest extends Request {
    pathname: string;              // URL pathname, e.g. "/blog/my-post"
    search: string;               // Query string, e.g. "?page=2"
    location: string;             // pathname + search
    cookies: Record<string, string>;
}
                    `}</Code>

                    <h3>useServerData&lt;T&gt;(key, fn)</h3>
                    <p>
                        Async server-side data fetching inside components. The <code>key</code> must
                        be stable and unique within the page. <code>fn</code> can return a{' '}
                        <code>Promise&lt;T&gt;</code> (normal async), return <code>T</code> synchronously,
                        or throw a thenable (Suspense protocol). Only <code>Promise</code>-returning
                        calls are serialised for the client; Suspense hooks manage their own hydration.
                    </p>
                    <Code lang="typescript">{`
import { useServerData } from 'hadars';

// Normal async — result is serialised into the page, no re-fetch on the client:
const data = useServerData('my_data', () => fetch('/api/data').then(r => r.json()));

// Array keys are joined internally — useful for dynamic values:
const post = useServerData(['post', postId], () => db.getPost(postId));

// Suspense hook — hadars awaits the thrown promise then re-renders;
// the library handles its own cache hydration, value is not serialised:
const result = useServerData(['posts'], () =>
    useSuspenseQuery({ queryKey: ['posts'], queryFn: fetchPosts })
);
                    `}</Code>

                    <h3>HadarsProps&lt;T&gt;</h3>
                    <Code lang="typescript">{`
type HadarsProps<T> = T & {
    location: string;    // current URL path
    context: AppContext; // pass to <HadarsContext>
};
                    `}</Code>
                </Section>

                {/* ── live demo ── */}
                <Section id="demo" title="Live demo">
                    <p>This page <em>is</em> a hadars app. The values below were produced on the server.</p>
                    <div className="demo-box">
                        <div className="demo-row">
                            <span className="demo-label">Server time</span>
                            <span className="demo-value">{serverTime}</span>
                        </div>
                        <div className="demo-row">
                            <span className="demo-label">Runtime</span>
                            <span className="demo-value">{bunVersion}</span>
                        </div>
                        <div className="demo-row">
                            <span className="demo-label">Location</span>
                            <span className="demo-value">{location}</span>
                        </div>
                        <ServerStatsRow />
                        <React.Suspense fallback={
                            <div className="demo-row">
                                <span className="demo-label">loadModule — lazy chunk</span>
                                <span className="demo-value">loading…</span>
                            </div>
                        }>
                            <LazyPanel />
                        </React.Suspense>
                        <div className="demo-row">
                            <span className="demo-label">Client counter</span>
                            <span className="demo-value">
                                <button className="btn" onClick={() => setCount(c => c - 1)}>−</button>
                                <strong> {count} </strong>
                                <button className="btn" onClick={() => setCount(c => c + 1)}>+</button>
                            </span>
                        </div>
                    </div>
                    <p className="demo-note">
                        The counter is zero on every page load (SSR renders it as zero, client hydrates it as zero).
                        Clicking the buttons proves the client-side React tree is live and hydrated.
                    </p>
                </Section>
                <SuspenseQueryRow />

                {/* ── footer ── */}
                <footer className="footer">
                    <p>hadars — MIT licence</p>
                </footer>
            </div>
            </QueryClientProvider>
        </HadarsContext>
    );
};

export const getInitProps = async (_req: HadarsRequest): Promise<PageProps> => {
    const runtime =
        typeof (globalThis as any).Bun !== 'undefined' ? `Bun ${(globalThis as any).Bun.version}` :
        typeof (globalThis as any).Deno !== 'undefined' ? `Deno ${(globalThis as any).Deno.version.deno}` :
        `Node.js ${process.version}`;

    const rcClient = new QueryClient();
    
    return {
        serverTime: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' }),
        bunVersion: runtime,
        rcClient,
    };
};

export const getFinalProps = async ( { rcClient, ...props }: Partial<PageProps> ): Promise<Partial<PageProps>> => {
    const client = rcClient as QueryClient;
    const cache = dehydrate(client);
    // Release the per-request QueryClient: clear() removes all cached queries
    // (and cancels their internal GC timers), unmount() unregisters focus/online
    // listeners — allowing the object to be GC'd immediately instead of after gcTime.
    client.clear();
    client.unmount();
    return {
        ...props,
        cache,
    }
}

export const getClientProps = async ( props: Partial<PageProps> ): Promise<Partial<PageProps>> => {

    const queryClient = new QueryClient({});
    hydrate(queryClient, props.cache as DehydratedState);

    return {
        ...props,
        rcClient: queryClient,
    }
}

const App = ((props: any) => {
    if (props.location === '/cache-test') {
        return <CacheTestPage serverTime={props.serverTime} context={props.context} />;
    }
    return <Home {...props} />;
}) as HadarsApp<PageProps>;

export default App;
