import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

// ── Side-by-side diff block ───────────────────────────────────────────────────

const SideBySide: React.FC<{
    label: string;
    nextCode: string;
    hadarsCode: string;
    nextLang?: 'tsx' | 'typescript' | 'bash';
    hadarsLang?: 'tsx' | 'typescript' | 'bash';
}> = ({ label, nextCode, hadarsCode, nextLang = 'tsx', hadarsLang = 'tsx' }) => (
    <div className="mb-8">
        <p className="text-sm text-muted-foreground mb-3 font-medium">{label}</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
                <div
                    className="rounded-t-md px-3 py-1.5 text-xs font-semibold flex items-center gap-2"
                    style={{ background: 'oklch(0.12 0.04 280)', borderBottom: '1px solid oklch(0.68 0.28 285 / 0.1)' }}
                >
                    <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ background: 'oklch(0.65 0.18 150)' }}
                    />
                    <span style={{ color: 'oklch(0.65 0.18 150)' }}>Next.js</span>
                </div>
                <div style={{ marginTop: 0 }}>
                    <Code lang={nextLang}>{nextCode}</Code>
                </div>
            </div>
            <div>
                <div
                    className="rounded-t-md px-3 py-1.5 text-xs font-semibold flex items-center gap-2"
                    style={{ background: 'oklch(0.12 0.04 280)', borderBottom: '1px solid oklch(0.68 0.28 285 / 0.1)' }}
                >
                    <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ background: 'oklch(0.68 0.28 285)' }}
                    />
                    <span className="text-primary">hadars</span>
                </div>
                <div style={{ marginTop: 0 }}>
                    <Code lang={hadarsLang}>{hadarsCode}</Code>
                </div>
            </div>
        </div>
    </div>
);

// ── Callout box ───────────────────────────────────────────────────────────────

const Note: React.FC<{ children: React.ReactNode; kind?: 'info' | 'tip' | 'warning' }> = ({
    children,
    kind = 'info',
}) => {
    const colors = {
        info:    { bg: 'oklch(0.68 0.28 285 / 0.07)', border: 'oklch(0.68 0.28 285 / 0.3)', icon: 'ℹ', label: 'Note',    text: 'oklch(0.75 0.15 285)' },
        tip:     { bg: 'oklch(0.65 0.20 160 / 0.07)', border: 'oklch(0.65 0.20 160 / 0.3)', icon: '✦', label: 'Tip',     text: 'oklch(0.70 0.15 160)' },
        warning: { bg: 'oklch(0.65 0.18 55  / 0.07)', border: 'oklch(0.65 0.18 55  / 0.3)', icon: '⚠', label: 'Note',    text: 'oklch(0.72 0.15 55)'  },
    }[kind];
    return (
        <div
            className="rounded-xl px-4 py-3 text-sm my-4 flex gap-3"
            style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
        >
            <span style={{ color: colors.text, flexShrink: 0 }}>{colors.icon}</span>
            <span className="text-muted-foreground">{children}</span>
        </div>
    );
};

// ── Comparison table row ──────────────────────────────────────────────────────

const Row: React.FC<{ feature: string; next: React.ReactNode; hadar: React.ReactNode }> = ({ feature, next, hadar }) => (
    <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
        <span className="text-muted-foreground">{feature}</span>
        <span className="text-muted-foreground">{next}</span>
        <span className="text-foreground">{hadar}</span>
    </div>
);

// ── Page ─────────────────────────────────────────────────────────────────────

const FromNextjs: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>Coming from Next.js — hadars</title>
            <meta name="description" content="Key differences between Next.js and hadars — routing, data fetching, head management, and what doesn't exist." />
            <meta property="og:title" content="Coming from Next.js — hadars" />
            <meta property="og:description" content="Key differences between Next.js and hadars — routing, data fetching, head management, and what doesn't exist." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">Coming from Next.js</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            No file-based routing, no special directory structure, no framework-specific
            patterns to unlearn. Just a React component, a config file, and a function
            that runs on the server.
        </p>

        {/* ── Philosophy ── */}
        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Philosophy</h2>
            <p className="text-muted-foreground mb-4">
                Next.js owns your routing, rendering mode, image pipeline, and deployment target.
                hadars does one thing: renders a React component on the server and hydrates it
                on the client. Your router, your CSS, your deploy target.
            </p>
            <div
                className="rounded-xl overflow-hidden divide-y"
                style={{ background: 'oklch(0.08 0.025 280)', border: '1px solid oklch(0.68 0.28 285 / 0.15)' }}
            >
                <div
                    className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'oklch(0.12 0.04 280)', color: 'oklch(0.60 0.08 285)' }}
                >
                    <span>Aspect</span><span>Next.js</span><span>hadars</span>
                </div>
                <Row feature="Routing"          next="File-based (pages/ or app/)"    hadar="Bring your own (react-router, TanStack Router, …)" />
                <Row feature="Data fetching"    next={<><code className="text-xs bg-muted px-1 rounded">getServerSideProps</code> / Server Components</>} hadar={<><code className="text-xs bg-muted px-1 rounded">getInitProps</code> + <code className="text-xs bg-muted px-1 rounded">useServerData</code></>} />
                <Row feature="Rendering modes"  next="SSR, SSG, ISR, PPR, edge"       hadar="SSR + static export (hadars export static)" />
                <Row feature="Head management"  next={<><code className="text-xs bg-muted px-1 rounded">next/head</code> / metadata API</>} hadar={<><code className="text-xs bg-muted px-1 rounded">{'<HadarsHead>'}</code> anywhere in the tree</>} />
                <Row feature="Static files"     next="public/ directory"              hadar="static/ directory at project root — served automatically" />
                <Row feature="Image handling"   next="next/image (automatic)"         hadar="Plain <img> (your CDN, your rules)" />
                <Row feature="CSS"              next="CSS Modules, built-in"          hadar="Anything (Tailwind, Emotion, plain CSS, …)" />
                <Row feature="Config"           next="next.config.js (large API)"     hadar="hadars.config.ts (~10 options)" />
                <Row feature="Bundle tool"      next="SWC + Webpack/Turbopack"        hadar="rspack + SWC" />
                <Row feature="Runtime"          next="Node.js / edge runtimes"        hadar="Node.js, Bun, Deno" />
                <Row feature="Deploy target"    next="Vercel / self-hosted"           hadar="Any HTTP server, AWS Lambda, or Cloudflare Workers" />
            </div>
        </section>

        {/* ── Project structure ── */}
        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Project structure</h2>
            <p className="text-muted-foreground mb-4">
                Next.js projects are organised around the framework's conventions.
                hadars has no opinion — the only required file is your entry component.
            </p>
            <SideBySide
                label="Typical project layout"
                nextLang="bash"
                hadarsLang="bash"
                nextCode={`
my-app/
├── app/                  # or pages/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── about/page.tsx
│   └── blog/[slug]/page.tsx
├── public/
├── next.config.js
└── package.json
                `}
                hadarsCode={`
my-app/
├── src/
│   ├── App.tsx           # single entry point
│   ├── pages/            # your choice
│   │   ├── Home.tsx
│   │   ├── About.tsx
│   │   └── Blog.tsx
│   └── components/
├── static/               # served as-is (≈ public/)
│   └── robots.txt
├── hadars.config.ts
└── package.json
                `}
            />
            <Note kind="tip">
                hadars has no <code className="text-xs bg-muted px-1 rounded">pages/</code> or{' '}
                <code className="text-xs bg-muted px-1 rounded">app/</code> convention. You can organise
                files however you like — hadars only cares about the single entry component you
                point to in <code className="text-xs bg-muted px-1 rounded">hadars.config.ts</code>.
            </Note>
        </section>

        {/* ── Routing ── */}
        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Routing</h2>
            <p className="text-muted-foreground mb-4">
                Next.js routes are created by adding files to a directory. hadars doesn't touch
                routing at all — you wire up your own router in your entry component.
            </p>
            <SideBySide
                label="Defining routes"
                nextCode={`
// app/page.tsx → "/"
export default function Home() {
    return <h1>Home</h1>;
}

// app/about/page.tsx → "/about"
export default function About() {
    return <h1>About</h1>;
}

// app/blog/[slug]/page.tsx → "/blog/:slug"
export default function Blog({ params }) {
    return <h1>{params.slug}</h1>;
}
                `}
                hadarsCode={`
// src/App.tsx — routes live in your component
import { BrowserRouter, StaticRouter,
         Routes, Route } from 'react-router-dom';

const App: HadarsApp<Props> = ({ location }) => {
    const routes = (
        <Routes>
            <Route path="/"            element={<Home />} />
            <Route path="/about"       element={<About />} />
            <Route path="/blog/:slug"  element={<Blog />} />
        </Routes>
    );
    if (typeof window === 'undefined')
        return <StaticRouter location={location}>{routes}</StaticRouter>;
    return <BrowserRouter>{routes}</BrowserRouter>;
};
                `}
            />
            <Note>
                Because hadars passes the current URL as a <code className="text-xs bg-muted px-1 rounded">location</code> prop,
                any SSR-compatible router will work: react-router, TanStack Router, wouter, etc.
            </Note>
        </section>

        {/* ── Data fetching ── */}
        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Data fetching</h2>
            <p className="text-muted-foreground mb-4">
                Next.js has several patterns depending on the rendering mode.
                hadars has three:{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">getInitProps</code> for
                request-level data,{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useServerData</code> for
                component-level async data, and{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useGraphQL</code> for
                component-level GraphQL queries (when source plugins or a custom executor are configured).
            </p>

            <SideBySide
                label="Fetching data for a page (App Router)"
                nextCode={`
// app/profile/page.tsx
async function getUser(id: string) {
    return fetch(\`/api/users/\${id}\`).then(r => r.json());
}

// Server Component — runs on the server
export default async function Profile() {
    const user = await getUser('123');
    return <h1>Hello {user.name}</h1>;
}
                `}
                hadarsCode={`
// src/pages/Profile.tsx
import { useServerData } from 'hadars';

// Runs inside the component during SSR.
// On the client, reads from the hydration cache.
const Profile: React.FC<{ userId: string }> = ({ userId }) => {
    const user = useServerData(() =>
        fetch(\`/api/users/\${userId}\`).then(r => r.json())
    );
    if (!user) return null;
    return <h1>Hello {user.name}</h1>;
};
                `}
            />

            <SideBySide
                label="Fetching data for the whole request (Pages Router equivalent)"
                nextCode={`
// pages/dashboard.tsx
export async function getServerSideProps(ctx) {
    const user = await db.getUser(ctx.req.cookies.session);
    return { props: { user } };
}

export default function Dashboard({ user }) {
    return <h1>Hello {user.name}</h1>;
}
                `}
                hadarsCode={`
// src/App.tsx (or wherever your route renders)
export const getInitProps = async (req: HadarsRequest) => {
    const user = await db.getUser(req.cookies.session);
    return { user };
};

const App: HadarsApp<{ user: User }> = ({ user }) => (
    <h1>Hello {user.name}</h1>
);
                `}
            />

            <Note kind="tip">
                <code className="text-xs bg-muted px-1 rounded">useServerData</code> batches all calls within
                one render into a single JSON request during client-side navigation — you never
                make N requests for N data hooks.
            </Note>
        </section>

        {/* ── Head management ── */}
        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Head management</h2>
            <SideBySide
                label="Setting the page title and meta tags"
                nextCode={`
// App Router — metadata export
export const metadata = {
    title: 'My page',
    description: 'A great page',
    openGraph: { title: 'My page' },
};

// — or — Pages Router
import Head from 'next/head';

export default function Page() {
    return (
        <>
            <Head>
                <title>My page</title>
                <meta name="description" content="A great page" />
            </Head>
            <main>...</main>
        </>
    );
}
                `}
                hadarsCode={`
import { HadarsHead } from 'hadars';

// Works in any component, any depth in the tree.
// Server: injects into <head> before sending HTML.
// Client: upserts — no duplicates on navigation.
const Page = () => (
    <>
        <HadarsHead status={200}>
            <title>My page</title>
            <meta name="description" content="A great page" />
            <meta property="og:title" content="My page" />
        </HadarsHead>
        <main>...</main>
    </>
);
                `}
            />
            <Note>
                Unlike <code className="text-xs bg-muted px-1 rounded">next/head</code>, HadarsHead deduplicates
                tags by their natural key (meta name, property, link rel+href, etc.) — navigating between
                pages updates existing tags in place rather than appending duplicates.
            </Note>
        </section>

        {/* ── HTTP status codes ── */}
        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">HTTP status codes</h2>
            <SideBySide
                label="Returning a 404"
                nextCode={`
// App Router
import { notFound } from 'next/navigation';

export default function Page({ params }) {
    const post = getPost(params.slug);
    if (!post) notFound();      // throws
    return <article>{post.title}</article>;
}

// Pages Router
export async function getServerSideProps() {
    return { notFound: true };
}
                `}
                hadarsCode={`
import { HadarsHead } from 'hadars';

// Set status on any HadarsHead in the tree.
// The last one with a status prop wins.
const NotFound: React.FC = () => (
    <>
        <HadarsHead status={404}>
            <title>Not found</title>
        </HadarsHead>
        <h1>Page not found</h1>
    </>
);

// In your router:
<Route path="*" element={<NotFound />} />
                `}
            />
        </section>

        {/* ── API routes ── */}
        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">API routes</h2>
            <p className="text-muted-foreground mb-4">
                Next.js has built-in API routes. hadars uses a{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">fetch</code> hook in the config for custom
                server-side handling — or you can proxy to a separate backend.
            </p>
            <SideBySide
                label="Handling a custom server endpoint"
                nextLang="typescript"
                hadarsLang="typescript"
                nextCode={`
// app/api/hello/route.ts
export async function GET(req: Request) {
    return Response.json({ message: 'hello' });
}
                `}
                hadarsCode={`
// hadars.config.ts
const config: HadarsOptions = {
    entry: 'src/App.tsx',

    fetch: async (req) => {
        if (req.pathname === '/api/hello') {
            return Response.json({ message: 'hello' });
        }
        // return undefined → falls through to SSR
    },
};
                `}
            />
            <Note kind="tip">
                The <code className="text-xs bg-muted px-1 rounded">fetch</code> hook intercepts every
                request before SSR. Return a <code className="text-xs bg-muted px-1 rounded">Response</code> to
                short-circuit; return nothing to let hadars render the page normally.
                For larger APIs, use <code className="text-xs bg-muted px-1 rounded">proxy</code> to forward
                requests to a dedicated service.
            </Note>
        </section>

        {/* ── Code splitting ── */}
        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Code splitting</h2>
            <SideBySide
                label="Lazy-loading a heavy component"
                nextCode={`
import dynamic from 'next/dynamic';

// Next.js wraps React.lazy with SSR control
const HeavyChart = dynamic(
    () => import('./HeavyChart'),
    { ssr: false }   // skip SSR for this component
);
                `}
                hadarsCode={`
import { loadModule } from 'hadars';

// loadModule is React.lazy-compatible.
// Browser: dynamic import() → separate JS chunk.
// Server: synchronous require() → included in SSR.
const HeavyChart = React.lazy(
    () => loadModule('./HeavyChart')
);
                `}
            />
            <Note>
                hadars doesn't have an <code className="text-xs bg-muted px-1 rounded">ssr: false</code> option — all
                split modules are included in the SSR bundle. If you need to skip SSR for a component, wrap it
                in a <code className="text-xs bg-muted px-1 rounded">{'typeof window !== "undefined"'}</code> guard.
            </Note>
        </section>

        {/* ── What doesn't exist ── */}
        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Things that don't exist in hadars</h2>
            <p className="text-muted-foreground mb-4">
                Some Next.js features simply don't exist in hadars. A few have direct alternatives;
                others you just don't need.
            </p>
            <div
                className="rounded-xl overflow-hidden divide-y"
                style={{ background: 'oklch(0.08 0.025 280)', border: '1px solid oklch(0.68 0.28 285 / 0.15)' }}
            >
                <div
                    className="grid grid-cols-2 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'oklch(0.12 0.04 280)', color: 'oklch(0.60 0.08 285)' }}
                >
                    <span>Next.js feature</span><span>hadars equivalent / alternative</span>
                </div>
                {[
                    ['Static Site Generation (SSG / getStaticProps)', 'hadars export static — pre-renders pages to HTML files. Add source plugins to pull data from any CMS.'],
                    ['Incremental Static Regeneration (ISR)', 'Use the SSR cache option with a TTL, or an external CDN cache. Full ISR is not supported.'],
                    ['Server Components / React RSC', 'Not yet. Use useServerData for component-level server data.'],
                    ['Middleware (edge, request rewriting)', 'Use the fetch hook in config or a reverse proxy (nginx, Cloudflare).'],
                    ['next/image (automatic optimisation)', 'Use your CDN or <img> directly. No build-time image processing.'],
                    ['next/font (automatic font loading)', 'Load fonts in your HTML template or as a <link> in HadarsHead.'],
                    ['Built-in internationalisation (i18n routing)', 'Handle locale in your router and getInitProps, or use i18next.'],
                    ['Parallel / intercepted routes', 'Not applicable — routing is entirely yours.'],
                ].map(([feat, alt]) => (
                    <div key={feat} className="grid grid-cols-2 gap-4 px-4 py-3 text-sm">
                        <code className="text-primary text-xs">{feat}</code>
                        <span className="text-muted-foreground">{alt}</span>
                    </div>
                ))}
            </div>
        </section>

        {/* ── When to choose hadars ── */}
        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">When to choose hadars</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                    { title: 'SSR without the framework overhead', desc: 'No file conventions, no special exports, no compiler transforms beyond what rspack does normally.' },
                    { title: 'You already picked a router', desc: 'react-router, TanStack Router, wouter — plug it in directly. hadars just passes the URL as a prop.' },
                    { title: 'AWS Lambda', desc: 'hadars export lambda builds a single self-contained .mjs. No filesystem reads on cold start.' },
                    { title: 'Bun or Deno', desc: 'Uses the standard Fetch API throughout. Same code runs on Node.js, Bun, and Deno unchanged.' },
                    { title: 'Minimal dependencies', desc: 'No peer deps beyond React. The only coupling is the config file — swap it out when you outgrow it.' },
                    { title: 'Static sites with a CMS', desc: 'hadars export static + Gatsby-compatible source plugins. Pull data from Contentful, local files, or any API — no Gatsby required.' },
                    { title: 'Dynamic, authenticated apps', desc: 'If every response depends on the user\'s session, SSG buys you nothing. SSR with a short cache TTL is faster to reason about.' },
                ].map(({ title, desc }) => (
                    <div
                        key={title}
                        className="rounded-xl p-4"
                        style={{ background: 'oklch(0.08 0.025 280)', border: '1px solid oklch(0.68 0.28 285 / 0.15)' }}
                    >
                        <p className="text-sm font-semibold text-gradient-soft mb-1">{title}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                    </div>
                ))}
            </div>
        </section>

        <footer
            className="mt-16 pt-8 text-center text-sm text-muted-foreground"
            style={{ borderTop: '1px solid oklch(0.68 0.28 285 / 0.15)' }}
        >
            <p>hadars — MIT licence</p>
        </footer>
    </>
);

export default FromNextjs;
