import React from 'react';
import { HadarsContext, HadarsHead, useServerData, loadModule, type HadarsApp, type HadarsRequest } from 'hadars';
import styled from '@emotion/styled';
import { ThemeProvider, useTheme } from '@emotion/react';
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

// ── emotion components ────────────────────────────────────────────────────────

interface EmotionTheme { accent: string; accent2: string; }
const emotionTheme: EmotionTheme = { accent: '#7c3aed', accent2: '#059669' };

const EmotionBadge = styled.span`
    display: inline-block;
    background: #7c3aed;
    color: #fff;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    letter-spacing: 0.05em;
`;

const EmotionBox = styled.div`
    border: 2px solid #7c3aed;
    border-radius: 0.5rem;
    padding: 1rem 1.25rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.9rem;
    margin-bottom: 1rem;
`;

const EmotionThemedBadge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const theme = useTheme() as EmotionTheme;
    const Badge = styled.span`
        display: inline-block;
        background: ${theme.accent2};
        color: #fff;
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.25rem 0.75rem;
        border-radius: 9999px;
    `;
    return <Badge>{children}</Badge>;
};

const EmotionDemo: React.FC = () => (
    <ThemeProvider theme={emotionTheme}>
        <EmotionBox>
            <EmotionBadge>@emotion/styled</EmotionBadge>
            <EmotionThemedBadge>@emotion/react useTheme</EmotionThemedBadge>
            <span style={{ color: '#888' }}>rendered on the server via slim-react</span>
        </EmotionBox>
    </ThemeProvider>
);

// ── tiny shared components ────────────────────────────────────────────────────

type CodeLang = 'tsx' | 'typescript' | 'bash';

const Code: React.FC<{ children: string; lang?: CodeLang }> = ({ children, lang = 'tsx' }) => {
    const grammar = (Prism.languages[lang] ?? Prism.languages.plaintext)!;
    const highlighted = Prism.highlight(children, grammar, lang);
    const [ready, setReady] = React.useState(false);
    
    // Avoid hydration mismatch by only Prism-highlighting on the client.
    React.useEffect(() => {
        setReady(true);
    }, []);

    if (!ready) {
        return (
            <pre className="code-block">
                <code>{children}</code>
            </pre>
        );
    }
    
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
    // On SSR, slim-react catches the thrown promise from useSuspenseQuery,
    // awaits it, then re-renders — the result populates the QueryClient cache.
    // getFinalProps dehydrates that cache; getClientProps rehydrates it, so
    // useSuspenseQuery returns synchronously on the client with no second fetch.
    const { data } = useSuspenseQuery({
        queryKey: ['data-fetch'],
        queryFn: async () => {
            const res = await fetch('http://localhost:9090/api/data');
            return res.json();
        },
        staleTime: Infinity,
    });

    return (
        <div className="demo-row">
            <span className="demo-label">useSuspenseQuery (dehydrated cache)</span>
            <span className="demo-value">{data ? JSON.stringify(data) : '—'}</span>
        </div>
    );
};

// ── useId demo components ─────────────────────────────────────────────────────

// Simple component: single useId for a form field.
const UseIdInput: React.FC<{ label: string }> = ({ label }) => {
    const id = React.useId();
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label htmlFor={id}>{label}</label>
            <input id={id} type="text" placeholder={label} className="btn" style={{ flex: 1 }} />
            <code style={{ fontSize: '0.7rem', color: '#888' }}>{id}</code>
        </div>
    );
};

// Component with multiple useId calls — each gets a unique, stable ID.
const MultiIdDemo: React.FC = () => {
    const nameId = React.useId();
    const emailId = React.useId();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor={nameId}>Name</label>
                <input id={nameId} type="text" placeholder="Name" className="btn" style={{ flex: 1 }} />
                <code style={{ fontSize: '0.7rem', color: '#888' }}>{nameId}</code>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor={emailId}>Email</label>
                <input id={emailId} type="email" placeholder="Email" className="btn" style={{ flex: 1 }} />
                <code style={{ fontSize: '0.7rem', color: '#888' }}>{emailId}</code>
            </div>
        </div>
    );
};

// Nested useId: parent and child each call useId, verifying tree-position encoding.
const ChildWithId: React.FC<{ label: string }> = ({ label }) => {
    const id = React.useId();
    return (
        <span style={{ fontSize: '0.85rem' }}>
            {label}: <code style={{ color: '#9cdcfe' }}>{id}</code>
        </span>
    );
};

const NestedIdDemo: React.FC = () => {
    const parentId = React.useId();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.85rem' }}>
                Parent: <code style={{ color: '#4ec9b0' }}>{parentId}</code>
            </span>
            <div style={{ display: 'flex', gap: '1rem', paddingLeft: '1rem' }}>
                <ChildWithId label="Child A" />
                <ChildWithId label="Child B" />
                <ChildWithId label="Child C" />
            </div>
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
        const proc = (globalThis as any).process;
        const res = {
            pid: proc?.pid ?? 0,
            mem: Math.round((proc?.memoryUsage?.()?.rss ?? 0) / 1024 / 1024),
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

// Demonstrates fn-stripping: the fetch URL and token below are server-only.
// The hadars rspack loader replaces `fn` with `()=>undefined` in the client
// bundle — so the secret endpoint and credentials never appear in browser JS.
// To verify after `hadars build`: search the .hadars/static/ JS files for the
// string "validate-token" — it will only be found in index.ssr.js (server),
// never in the client chunks.
const ServerOnlySecretRow: React.FC = () => {
    const result = useServerData<{ user: string; role: string }>(
        'internal_auth_demo',
        async () => {
            // Everything inside this callback is stripped from the browser bundle.
            // In a real app this would reach an internal service with auth credentials.
            // These literals stay in index.ssr.js but must NEVER appear in client chunks.
            const TOKEN = 'Bearer ey_super_secret_internal_token';
            const url = 'https://internal-auth.internal/validate-token';
            // fetch() has observable I/O side-effects — minifiers keep the strings.
            // (The demo domain doesn't exist; we swallow the error and return mocks.)
            const data = await fetch(url, { headers: { Authorization: TOKEN } })
                .then(r => r.json() as Promise<{ user: string; role: string }>)
                .catch(() => null);
            return data ?? { user: 'alice', role: 'admin' };
        },
    );

    return (
        <div className="demo-row">
            <span className="demo-label">
                useServerData — fn stripped from client bundle
            </span>
            <span className="demo-value">
                {result
                    ? `${result.user} (${result.role}) — fn was stripped from this bundle`
                    : '—'}
            </span>
        </div>
    );
};

// ── client-side navigation helper ────────────────────────────────────────────

/** Push a new URL without a full page reload and fire a popstate event so the
 *  App router re-renders.  Falls back gracefully when called on the server. */
function navigate(to: string) {
    if (typeof window === 'undefined') return;
    history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
}

// ── /data-demo page ───────────────────────────────────────────────────────────

// Four independent components, each with their own useServerData key.
// When this page is reached via client-side navigation (pushState), none of
// these keys exist in clientServerDataCache yet.  The first component to
// render triggers a batched GET /data-demo with Accept: application/json;
// the remaining three join the same in-flight promise via pendingDataFetch.
// A single network request, four values — the Suspense fallback below is
// shown for the entire group until that one request completes.

const DemoHostnameRow: React.FC = () => {
    const val = useServerData<string>('demo_hostname', async () => {
        const os = await import('node:os');
        return (os as any).hostname?.() ?? 'unknown';
    });
    return (
        <div className="demo-row">
            <span className="demo-label">Hostname</span>
            <span className="demo-value">{val ?? '—'}</span>
        </div>
    );
};

const DemoUptimeRow: React.FC = () => {
    const val = useServerData<number>('demo_uptime', async () => {
        return Math.round((globalThis as any).process?.uptime?.() ?? 0);
    });
    return (
        <div className="demo-row">
            <span className="demo-label">Process uptime (s)</span>
            <span className="demo-value">{val !== undefined ? `${val} s` : '—'}</span>
        </div>
    );
};

const DemoEnvRow: React.FC = () => {
    const val = useServerData<string>('demo_node_env', async () => {
        return (globalThis as any).process?.env?.NODE_ENV ?? 'unknown';
    });
    return (
        <div className="demo-row">
            <span className="demo-label">NODE_ENV</span>
            <span className="demo-value">{val ?? '—'}</span>
        </div>
    );
};

const DemoPlatformRow: React.FC = () => {
    const val = useServerData<string>('demo_platform', async () => {
        return (globalThis as any).process?.platform ?? 'unknown';
    });
    return (
        <div className="demo-row">
            <span className="demo-label">Platform</span>
            <span className="demo-value">{val ?? '—'}</span>
        </div>
    );
};

const DataDemoPage: React.FC<{ context: any }> = ({ context }) => {
    const [fetchCount, setFetchCount] = React.useState(0);
    const [lastFetchTime, setLastFetchTime] = React.useState<string | null>(null);
    const [intercepting, setIntercepting] = React.useState(false);

    // On the client: intercept the fetch that useServerData will make and
    // record how many times it fires — should always be exactly 1 per
    // navigation, regardless of how many useServerData keys are in the tree.
    React.useEffect(() => {
        if (typeof window === 'undefined' || intercepting) return;
        setIntercepting(true);
        const original = window.fetch;
        window.fetch = (async (...args: Parameters<typeof fetch>) => {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
            const headers = args[1]?.headers as Record<string, string> | undefined;
            const accept = headers?.['Accept'] ?? (args[0] instanceof Request ? args[0].headers.get('Accept') : null);
            if (accept === 'application/json' && url.includes('/data-demo')) {
                setFetchCount(c => c + 1);
                setLastFetchTime(new Date().toLocaleTimeString());
            }
            return original.apply(window, args);
        }) as typeof fetch;
        return () => { window.fetch = original; };
    }, [intercepting]);

    return (
        <HadarsContext context={context}>
            <HadarsHead status={200}>
                <title>Data fetch demo — hadars</title>
            </HadarsHead>
            <div className="layout">
                <nav className="navbar">
                    <a className="navbar-brand" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>hadars</a>
                    <div className="navbar-links">
                        <a href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>← Home</a>
                        <a href="/cache-test" onClick={e => { e.preventDefault(); navigate('/cache-test'); }}>Cache test</a>
                    </div>
                </nav>
                <header className="hero" style={{ paddingBottom: '2rem' }}>
                    <h1>Batched <code>useServerData</code> demo</h1>
                    <p className="hero-sub">
                        This page contains <strong>four independent components</strong>, each calling{' '}
                        <code>useServerData</code> with a different key. When you arrive via{' '}
                        client-side navigation (the link from Home), none of these keys exist in
                        the client cache — a single <code>GET /data-demo</code> with{' '}
                        <code>Accept: application/json</code> is fired, all four values are returned
                        in one response, and all four components render simultaneously.
                    </p>
                </header>
                <section className="doc-section">
                    <h2>Server data (four keys, one request)</h2>
                    <div className="demo-box">
                        <React.Suspense fallback={
                            <div className="demo-row">
                                <span className="demo-label">Loading…</span>
                                <span className="demo-value" style={{ color: '#888' }}>
                                    fetching all four keys in one batched request
                                </span>
                            </div>
                        }>
                            <DemoHostnameRow />
                            <DemoUptimeRow />
                            <DemoEnvRow />
                            <DemoPlatformRow />
                        </React.Suspense>
                    </div>
                    <div className="demo-box" style={{ marginTop: '1rem' }}>
                        <div className="demo-row">
                            <span className="demo-label">
                                <code>Accept: application/json</code> requests fired
                            </span>
                            <span className="demo-value" style={{ color: fetchCount === 1 ? '#4ec9b0' : fetchCount > 1 ? '#f97316' : '#888' }}>
                                {fetchCount === 0
                                    ? 'none yet (SSR-seeded — no fetch needed on first load)'
                                    : fetchCount === 1
                                        ? `1 (at ${lastFetchTime}) — batching works ✓`
                                        : `${fetchCount} ← unexpected (should be 1)`}
                            </span>
                        </div>
                        <div className="demo-row">
                            <span className="demo-label">How to test batching</span>
                            <span className="demo-value" style={{ color: '#888', fontSize: '0.85rem' }}>
                                Navigate away (Home) then back here via the nav link. The counter
                                should increment by exactly 1 each time you return.
                            </span>
                        </div>
                    </div>
                </section>
                <footer className="footer"><p>hadars — MIT licence</p></footer>
            </div>
        </HadarsContext>
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
                    <a className="navbar-brand" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>hadars</a>
                    <div className="navbar-links">
                        <a href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>← Home</a>
                        <a href="/data-demo" onClick={e => { e.preventDefault(); navigate('/data-demo'); }}>Data fetch demo</a>
                    </div>
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
                        <a href="/cache-test" onClick={e => { e.preventDefault(); navigate('/cache-test'); }}>Cache test</a>
                        <a href="/data-demo" onClick={e => { e.preventDefault(); navigate('/data-demo'); }}>Data fetch demo</a>
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
                        <Code lang="bash">hadars dev</Code>
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
                    {/* <Code lang="typescript">{`
import os from 'os';
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    port: 3000,
    // Fork one worker per CPU core in production (Node.js only).
    workers: os.cpus().length,
};

export default config;
                    `}</Code> */}

                    <h3>2 — src/App.tsx</h3>
                    {/* <Code>{`
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
                    `}</Code> */}
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
                    {/* <Code>{`
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
                    `}</Code> */}
                    <h3>Async data with useServerData</h3>
                    <p>
                        <code>useServerData(key, fn)</code> lets any component fetch async data
                        during SSR without plumbing it through <code>getInitProps</code>.
                        The framework re-renders the tree until every promise resolves, then
                        serialises the results into the page so the client hydrates with the
                        same values — no second fetch in the browser.
                    </p>
                    {/* <Code>{`
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
                    `}</Code> */}

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
                    {/* <Code>{`
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
                    `}</Code> */}
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
                    {/* <Code lang="typescript">{`
interface HadarsRequest extends Request {
    pathname: string;              // URL pathname, e.g. "/blog/my-post"
    search: string;               // Query string, e.g. "?page=2"
    location: string;             // pathname + search
    cookies: Record<string, string>;
}
                    `}</Code> */}

                    <h3>useServerData&lt;T&gt;(key, fn)</h3>
                    <p>
                        Async server-side data fetching inside components. The <code>key</code> must
                        be stable and unique within the page. <code>fn</code> can return a{' '}
                        <code>Promise&lt;T&gt;</code> (normal async), return <code>T</code> synchronously,
                        or throw a thenable (Suspense protocol). Only <code>Promise</code>-returning
                        calls are serialised for the client; Suspense hooks manage their own hydration.
                    </p>
                    {/* <Code lang="typescript">{`
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
                    `}</Code> */}

                    <h3>HadarsProps&lt;T&gt;</h3>
                    {/* <Code lang="typescript">{`
type HadarsProps<T> = T & {
    location: string;    // current URL path
    context: AppContext; // pass to <HadarsContext>
};
                    `}</Code> */}
                </Section>

                {/* ── live demo ── */}
                <Section id="demo" title="Live demo">
                    <p>This page <em>is</em> a hadars app. The values below were produced on the server.</p>
                    <EmotionDemo />
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
                        <ServerOnlySecretRow />
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
                <React.Suspense fallback={
                    <div className="demo-row">
                        <span className="demo-label">useSuspenseQuery</span>
                        <span className="demo-value">loading…</span>
                    </div>
                }>
                    <SuspenseQueryRow />
                </React.Suspense>

                {/* ── useId hydration test ── */}
                <Section id="useid" title="useId() hydration test">
                    <p>
                        These components call <code>React.useId()</code> during SSR via slim-react.
                        The IDs shown below are generated server-side and must match what React
                        produces on the client during <code>hydrateRoot</code> — if they don't,
                        you'll see a hydration mismatch warning in the console.
                    </p>
                    <div className="demo-box">
                        <div className="demo-row">
                            <span className="demo-label">Single useId</span>
                            <span className="demo-value" style={{ flex: 1 }}>
                                <UseIdInput label="Username" />
                            </span>
                        </div>
                        <div className="demo-row">
                            <span className="demo-label">Multiple useId calls</span>
                            <span className="demo-value" style={{ flex: 1 }}>
                                <MultiIdDemo />
                            </span>
                        </div>
                        <div className="demo-row">
                            <span className="demo-label">Nested components</span>
                            <span className="demo-value" style={{ flex: 1 }}>
                                <NestedIdDemo />
                            </span>
                        </div>
                    </div>
                    <p className="demo-note">
                        The <code>«R…»</code> identifiers are React 19.1's tree-position-based IDs.
                        Open the browser console — no hydration mismatch warnings means
                        slim-react and React agree on every ID.
                    </p>
                </Section>

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
        `Node.js ${(globalThis as any).process?.version ?? ''}`;

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
    // Note: do NOT call client.clear() / client.unmount() here.
    // buildSsrResponse renders the final HTML after getFinalProps returns, and
    // that render still needs the QueryClient cache to be populated so that
    // useSuspenseQuery returns synchronously without re-fetching.
    // The per-request QueryClient is GC'd when the request completes.
    return {
        ...props,
        cache,
    }
}

export const getClientProps = async ( props: Partial<PageProps> ): Promise<Partial<PageProps>> => {

    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { staleTime: Infinity },
        },
    });
    hydrate(queryClient, props.cache as DehydratedState);

    return {
        ...props,
        rcClient: queryClient,
    }
}

const App = ((props: any) => {
    // Track location in state so client-side navigation (pushState + popstate)
    // triggers a re-render without a full page reload.
    const [location, setLocation] = React.useState<string>(props.location);

    React.useEffect(() => {
        const handler = () =>
            setLocation(window.location.pathname + window.location.search);
        window.addEventListener('popstate', handler);
        return () => window.removeEventListener('popstate', handler);
    }, []);

    if (location === '/cache-test') {
        return <CacheTestPage serverTime={props.serverTime} context={props.context} />;
    }
    if (location === '/data-demo') {
        return <DataDemoPage context={props.context} />;
    }
    return <Home {...props} location={location} />;
}) as HadarsApp<PageProps>;

export default App;
