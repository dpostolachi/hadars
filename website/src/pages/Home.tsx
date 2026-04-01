import React from 'react';
import { Link } from 'react-router-dom';
import { HadarsHead } from 'hadars';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useServerData, loadModule } from 'hadars';
import Code from '../components/Code';
import HadarsLogo from '../components/HadarsLogo';

const LazyPanel = React.lazy(() => loadModule<{ default: React.FC }>('../LazyPanel'));

// ── live demo components ──────────────────────────────────────────────────────

interface ProcessStats { pid: number; mem: number }

const ServerStatsRow: React.FC = () => {
    const stats = useServerData<ProcessStats>(async () => {
        const proc = (globalThis as any).process;
        return {
            pid: proc?.pid ?? 0,
            mem: Math.round((proc?.memoryUsage?.()?.rss ?? 0) / 1024 / 1024),
        };
    }, { cache: false });
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <span className="text-sm text-muted-foreground w-48 shrink-0">useServerData</span>
            <span className="text-sm font-mono">
                {stats ? `pid ${stats.pid} · ${stats.mem} MB RSS` : '—'}
            </span>
        </div>
    );
};

const SuspenseQueryRow: React.FC = () => {
    const { data } = useSuspenseQuery({
        queryKey: ['weather'],
        queryFn: async () => {
            const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=53.5569&longitude=9.9946&current_weather=true');
            return res.json();
        },
        staleTime: Infinity,
    });
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <span className="text-sm text-muted-foreground w-48 shrink-0">useSuspenseQuery</span>
            <span className="text-sm font-mono">{data ? JSON.stringify((data as any).current_weather?.temperature) + ' °C' : '—'}</span>
        </div>
    );
};

const UseIdInput: React.FC<{ label: string }> = ({ label }) => {
    const id = React.useId();
    return (
        <div className="flex items-center gap-2">
            <label htmlFor={id} className="text-sm">{label}</label>
            <input id={id} type="text" placeholder={label} className="flex-1 h-7 px-2 rounded-md border border-border bg-muted text-sm font-mono" />
            <code className="text-xs text-muted-foreground">{id}</code>
        </div>
    );
};

// ── feature card ──────────────────────────────────────────────────────────────

const FeatureCard: React.FC<{ icon: string; title: string; desc: string }> = ({ icon, title, desc }) => (
    <div
        className="rounded-xl p-5 flex flex-col gap-2 transition-all duration-300"
        style={{
            background: 'oklch(0.08 0.025 280)',
            border: '1px solid oklch(0.68 0.28 285 / 0.15)',
        }}
        onMouseEnter={e => {
            (e.currentTarget as HTMLDivElement).style.border = '1px solid oklch(0.68 0.28 285 / 0.4)';
            (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 24px oklch(0.68 0.28 285 / 0.12), 0 0 48px oklch(0.68 0.28 285 / 0.04)';
        }}
        onMouseLeave={e => {
            (e.currentTarget as HTMLDivElement).style.border = '1px solid oklch(0.68 0.28 285 / 0.15)';
            (e.currentTarget as HTMLDivElement).style.boxShadow = '';
        }}
    >
        <span className="text-2xl">{icon}</span>
        <h3 className="font-semibold text-sm text-gradient-soft">{title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </div>
);

// ── pill badge ────────────────────────────────────────────────────────────────

const CosmicPill: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span
        className="inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium text-primary transition-all"
        style={{
            background: 'oklch(0.68 0.28 285 / 0.1)',
            border: '1px solid oklch(0.68 0.28 285 / 0.3)',
        }}
    >
        {children}
    </span>
);

// ── page ──────────────────────────────────────────────────────────────────────

export interface HomeProps {
    serverTime: string;
    bunVersion: string;
    rcClient?: any;
}

const Home: React.FC<HomeProps> = ({ serverTime, bunVersion }) => {
    const [count, setCount] = React.useState(0);

    return (
        <>
            <HadarsHead status={200}>
                <title>hadars — SSR for React</title>
                <meta name="description" content="Minimal SSR for React. Server-render a component, hydrate on the client, ship it." />
                <meta property="og:title" content="hadars — SSR for React" />
                <meta property="og:description" content="Minimal SSR for React. Server-render a component, hydrate on the client, ship it." />
            </HadarsHead>

            {/* hero */}
            <header className="py-16 mb-8 text-center relative">
                {/* Aura glow behind heading */}
                <div
                    className="absolute inset-x-0 top-8 h-40 pointer-events-none"
                    style={{
                        background: 'radial-gradient(ellipse 70% 60% at 50% 50%, oklch(0.68 0.28 285 / 0.07) 0%, transparent 70%)',
                    }}
                />

                <div className="flex flex-wrap gap-2 justify-center mb-8 relative">
                    {['SSR', 'HMR', 'TypeScript', 'React 19', 'Bun', 'Node.js', 'rspack'].map(t => (
                        <CosmicPill key={t}>{t}</CosmicPill>
                    ))}
                </div>

                {/* Logo + wordmark */}
                <div className="flex items-center justify-center gap-3 mb-5">
                    <HadarsLogo size={56} />
                    <span className="text-5xl font-bold tracking-tight font-mono text-gradient">hadars</span>
                </div>

                <h1 className="text-2xl font-medium mb-5 tracking-wide relative" style={{ color: 'oklch(0.75 0.06 285)' }}>
                    Server-side React, without the ceremony.
                </h1>

                <p className="text-muted-foreground text-lg max-w-lg mx-auto mb-8">
                    A minimal SSR framework built on rspack.
                    Export a component, export{' '}
                    <code className="text-sm bg-muted px-1.5 py-0.5 rounded text-primary/80">getInitProps</code>,
                    run one command.
                </p>

                <div className="max-w-xs mx-auto">
                    <Code lang="bash">npx hadars new my-app</Code>
                </div>
            </header>

            {/* features */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-14">
                {[
                    { icon: '⚡', title: 'React Fast Refresh', desc: 'Full HMR via rspack-dev-server — module-level patches, no full-page reloads.' },
                    { icon: '🖥️', title: 'True SSR', desc: 'Components render on the server with your data, then hydrate on the client.' },
                    { icon: '✂️', title: 'Code splitting', desc: 'loadModule(\'./Comp\') splits on the browser and bundles statically on the server.' },
                    { icon: '🦴', title: 'Head management', desc: 'HadarsHead controls title, meta, link, and script tags on both server and client.' },
                    { icon: '🌐', title: 'Cross-runtime', desc: 'Bun, Node.js, and Deno — uses the standard Fetch API throughout.' },
                    { icon: '⚙️', title: 'Multi-core', desc: 'Set workers: os.cpus().length to fork a process per CPU core in production.' },
                ].map(p => <FeatureCard key={p.title} {...p} />)}
            </section>

            {/* quick example */}
            <section className="mb-10">
                <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Minimal example</h2>
                <Code lang="typescript">{`
// hadars.config.ts
import type { HadarsOptions } from 'hadars';
const config: HadarsOptions = { entry: 'src/App.tsx', port: 3000 };
export default config;
                `}</Code>
                <Code>{`
// src/App.tsx
import React from 'react';
import { HadarsHead, type HadarsApp, type HadarsRequest } from 'hadars';

interface Props { user: { name: string } }

const App: HadarsApp<Props> = ({ user }) => (
    <>
        <HadarsHead status={200}>
            <title>Hello {user.name}</title>
        </HadarsHead>
        <h1>Hello, {user.name}!</h1>
    </>
);

export const getInitProps = async (req: HadarsRequest): Promise<Props> => ({
    user: await db.getUser(req.cookies.session),
});

export default App;
                `}</Code>
                <Link
                    to="/docs/getting-started"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors mt-1"
                >
                    Full getting started guide →
                </Link>
            </section>

            {/* live demo */}
            <section className="mb-10" id="demo">
                <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Live demo</h2>
                <p className="text-muted-foreground mb-4">This page <em>is</em> a hadars app. The values below were produced on the server.</p>
                <div
                    className="rounded-xl divide-y overflow-hidden"
                    style={{
                        background: 'oklch(0.08 0.025 280)',
                        border: '1px solid oklch(0.68 0.28 285 / 0.2)',
                        boxShadow: '0 0 32px oklch(0.68 0.28 285 / 0.06)',
                        divideColor: 'oklch(0.68 0.28 285 / 0.1)',
                    }}
                >
                    <DemoRow label="Server time">{serverTime}</DemoRow>
                    <DemoRow label="Runtime">{bunVersion}</DemoRow>
                    <ServerStatsRow />
                    <React.Suspense fallback={<DemoRow label="useSuspenseQuery"><span className="text-muted-foreground">loading…</span></DemoRow>}>
                        <SuspenseQueryRow />
                    </React.Suspense>
                    <React.Suspense fallback={<DemoRow label="loadModule (lazy chunk)"><span className="text-muted-foreground">loading…</span></DemoRow>}>
                        <LazyPanel />
                    </React.Suspense>
                    <div className="flex items-center gap-4 px-4 py-3" style={{ borderColor: 'oklch(0.68 0.28 285 / 0.1)' }}>
                        <span className="text-sm text-muted-foreground w-48 shrink-0">useId() SSR</span>
                        <span className="flex-1 text-sm">
                            <UseIdInput label="Username" />
                        </span>
                    </div>
                    <div className="flex items-center gap-4 px-4 py-3" style={{ borderColor: 'oklch(0.68 0.28 285 / 0.1)' }}>
                        <span className="text-sm text-muted-foreground w-48 shrink-0">Client counter</span>
                        <span className="flex items-center gap-2 text-sm">
                            <CosmicButton onClick={() => setCount(c => c - 1)}>−</CosmicButton>
                            <strong className="font-mono w-6 text-center tabular-nums">{count}</strong>
                            <CosmicButton onClick={() => setCount(c => c + 1)}>+</CosmicButton>
                        </span>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3 italic">
                    Counter starts at zero on every load (SSR renders 0, client hydrates 0).
                    Clicking proves the React tree is live. Open the console — no hydration warnings.
                </p>
            </section>

            <footer className="mt-16 pt-8 text-center text-sm text-muted-foreground" style={{ borderTop: '1px solid oklch(0.68 0.28 285 / 0.15)' }}>
                <p>hadars — MIT licence</p>
            </footer>
        </>
    );
};

const DemoRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-center gap-4 px-4 py-3" style={{ borderColor: 'oklch(0.68 0.28 285 / 0.1)' }}>
        <span className="text-sm text-muted-foreground w-48 shrink-0">{label}</span>
        <span className="text-sm font-mono">{children}</span>
    </div>
);

const CosmicButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
    <button
        className="h-6 w-6 rounded text-sm font-bold transition-all"
        style={{
            background: 'oklch(0.68 0.28 285 / 0.1)',
            border: '1px solid oklch(0.68 0.28 285 / 0.3)',
            color: 'oklch(0.75 0.20 285)',
        }}
        onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'oklch(0.68 0.28 285 / 0.2)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 8px oklch(0.68 0.28 285 / 0.3)';
        }}
        onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'oklch(0.68 0.28 285 / 0.1)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '';
        }}
        onClick={onClick}
    >
        {children}
    </button>
);

export default Home;
