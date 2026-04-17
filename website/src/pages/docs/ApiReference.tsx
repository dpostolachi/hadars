import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const ApiReference: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>API Reference — hadars</title>
            <meta name="description" content="Complete API reference for hadars — HadarsApp, HadarsRequest, HadarsHead, useServerData, loadModule, and config options." />
            <meta property="og:title" content="API Reference — hadars" />
            <meta property="og:description" content="Complete API reference for hadars — HadarsApp, HadarsRequest, HadarsHead, useServerData, loadModule, and config options." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">API Reference</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">Complete reference for HadarsOptions, hooks, and TypeScript types.</p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">HadarsOptions</h2>
            <p className="text-muted-foreground mb-4">Defined in <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars.config.ts</code> at your project root.</p>
            <div className="rounded-xl overflow-hidden divide-y mb-4" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.15)", boxShadow: "0 0 20px oklch(0.68 0.28 285 / 0.04)" }}>
                <div className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: "oklch(0.12 0.04 280)", color: "oklch(0.60 0.08 285)" }}>
                    <span>Option</span><span>Type</span><span>Description</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">entry</code><span className="text-muted-foreground">string</span><span className="text-muted-foreground">Path to your page component. <strong className="text-foreground">Required.</strong></span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">port</code><span className="text-muted-foreground">number</span><span className="text-muted-foreground">HTTP port. Default: <code className="text-sm bg-muted px-1 rounded">9090</code>.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">hmrPort</code><span className="text-muted-foreground">number</span><span className="text-muted-foreground">rspack HMR dev server port. Default: <code className="text-sm bg-muted px-1 rounded">port + 1</code>.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">baseURL</code><span className="text-muted-foreground">string</span><span className="text-muted-foreground">Public base path, e.g. <code className="text-sm bg-muted px-1 rounded">"/app"</code>. Default: <code className="text-sm bg-muted px-1 rounded">""</code>.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">workers</code><span className="text-muted-foreground">number</span><span className="text-muted-foreground">Worker processes forked in <code className="text-sm bg-muted px-1 rounded">run()</code> mode (Node.js only). Default: <code className="text-sm bg-muted px-1 rounded">1</code>.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">proxy</code><span className="text-muted-foreground">Record / fn</span><span className="text-muted-foreground">Path-prefix proxy rules or a custom async function.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">proxyCORS</code><span className="text-muted-foreground">boolean</span><span className="text-muted-foreground">Inject CORS headers on proxied responses.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">define</code><span className="text-muted-foreground">Record</span><span className="text-muted-foreground">Compile-time constants for rspack's DefinePlugin.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">swcPlugins</code><span className="text-muted-foreground">array</span><span className="text-muted-foreground">Extra SWC plugins (e.g. Relay compiler).</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">moduleRules</code><span className="text-muted-foreground">array</span><span className="text-muted-foreground">Extra rspack module rules appended to the built-in set (client + SSR).</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">fetch</code><span className="text-muted-foreground">function</span><span className="text-muted-foreground">Custom fetch handler. Return a <code className="text-sm bg-muted px-1 rounded">Response</code> to short-circuit SSR.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">websocket</code><span className="text-muted-foreground">object</span><span className="text-muted-foreground">WebSocket handler (Bun only), forwarded to <code className="text-sm bg-muted px-1 rounded">Bun.serve</code>.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">wsPath</code><span className="text-muted-foreground">string</span><span className="text-muted-foreground">Path that triggers WebSocket upgrade. Default: <code className="text-sm bg-muted px-1 rounded">"/ws"</code>.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">htmlTemplate</code><span className="text-muted-foreground">string</span><span className="text-muted-foreground">Path to a custom HTML template with <code className="text-sm bg-muted px-1 rounded">HADARS_HEAD</code> / <code className="text-sm bg-muted px-1 rounded">HADARS_BODY</code> markers.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">optimization</code><span className="text-muted-foreground">object</span><span className="text-muted-foreground">Override rspack <code className="text-sm bg-muted px-1 rounded">optimization</code> for production client builds.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">cache</code><span className="text-muted-foreground">function</span><span className="text-muted-foreground">SSR response cache for <code className="text-sm bg-muted px-1 rounded">run()</code> mode. Return <code className="text-sm bg-muted px-1 rounded">{'{ key, ttl? }'}</code> to cache a request.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">paths</code><span className="text-muted-foreground">function</span><span className="text-muted-foreground">Returns URL list to pre-render with <code className="text-sm bg-muted px-1 rounded">hadars export static</code>. Receives <code className="text-sm bg-muted px-1 rounded">HadarsStaticContext</code>.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">sources</code><span className="text-muted-foreground">array</span><span className="text-muted-foreground">Gatsby-compatible source plugins. hadars infers a GraphQL schema from their nodes automatically.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">graphql</code><span className="text-muted-foreground">function</span><span className="text-muted-foreground">Custom GraphQL executor. Passed to <code className="text-sm bg-muted px-1 rounded">paths()</code>, <code className="text-sm bg-muted px-1 rounded">getInitProps()</code>, and <code className="text-sm bg-muted px-1 rounded">useGraphQL()</code>.</span></div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm"><code className="text-primary">onError</code><span className="text-muted-foreground">function</span><span className="text-muted-foreground">Called on every SSR render error. Use to forward to Sentry, Datadog, etc. May be async — hadars fires it without awaiting.</span></div>
            </div>

            <h3 className="text-lg font-semibold mb-3 text-gradient-soft">Example</h3>
            <Code lang="typescript">{`
import os from 'os';
import * as Sentry from '@sentry/node';
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    port: 3000,
    workers: os.cpus().length,

    // Proxy /api/* to an internal service
    proxy: { '/api': 'http://localhost:4000' },

    // Short-circuit specific paths
    fetch: async (req) => {
        if (req.pathname === '/health') {
            return new Response('ok');
        }
    },

    // Cache pages by pathname for 60 seconds, skip authenticated users
    cache: (req) => req.cookies.session
        ? null
        : { key: req.pathname, ttl: 60_000 },

    // Expose a build-time constant to client bundles
    define: { '__APP_VERSION__': JSON.stringify('1.2.3') },

    // Forward SSR errors to your monitoring service
    onError: (err, req) => Sentry.captureException(err, {
        extra: { url: req.url, method: req.method },
    }),
};

export default config;
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">HadarsRequest</h2>
            <p className="text-muted-foreground mb-4">The request object passed to <code className="text-sm bg-muted px-1.5 py-0.5 rounded">getInitProps</code> and the <code className="text-sm bg-muted px-1.5 py-0.5 rounded">fetch</code> handler:</p>
            <Code lang="typescript">{`
interface HadarsRequest extends Request {
    pathname: string;               // URL pathname, e.g. "/blog/my-post"
    search: string;                 // Query string, e.g. "?page=2&sort=asc"
    location: string;               // pathname + search
    cookies: Record<string, string>;
}
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">HadarsApp</h2>
            <p className="text-muted-foreground mb-4">The type for your default-exported page component:</p>
            <Code lang="typescript">{`
type HadarsApp<T> = React.FC<T & {
    location: string;        // current URL (pathname + search)
}>;

// Usage
const App: HadarsApp<Props> = ({ user, location }) => (
    <>
        <HadarsHead status={200}><title>{user.name}</title></HadarsHead>
        ...
    </>
);
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Lifecycle hooks</h2>
            <Code lang="typescript">{`
// Runs on the server for every request.
// Return value becomes the props passed to your App component.
export const getInitProps = async (req: HadarsRequest): Promise<Props> => {
    return { user: await db.getUser(req.cookies.session) };
};

// Runs on the server after the final SSR render.
// Strip server-only fields before props are JSON-serialised for the client.
export const getFinalProps = async (props: Props): Promise<PublicProps> => {
    const { dbConnection, ...rest } = props;
    return rest;
};

// Runs in the browser after the page loads.
// Return value replaces/extends props before hydrateRoot is called.
export const getClientProps = async (props: PublicProps): Promise<ClientProps> => {
    return {
        ...props,
        theme: localStorage.getItem('theme') ?? 'dark',
    };
};
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">useServerData</h2>
            <Code lang="typescript">{`
function useServerData<T>(
    fn: () => Promise<T> | T,
    options?: { cache?: boolean }
): T | undefined
            `}</Code>
            <p className="text-muted-foreground mt-4">
                Fetches async data during SSR inside any component. Returns <code className="text-sm bg-muted px-1.5 py-0.5 rounded">undefined</code>{' '}
                on the first pass(es) while the promise is in-flight, then the resolved value on
                the final pass. On the client, reads from the hydration cache — <code className="text-sm bg-muted px-1.5 py-0.5 rounded">fn</code>{' '}
                is never called in the browser. The cache key is derived automatically from the
                call-site's position in the component tree via <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useId()</code>.
            </p>
            <p className="text-muted-foreground mt-3">
                For client-side navigation, fires a single <code className="text-sm bg-muted px-1.5 py-0.5 rounded">GET &lt;url&gt;</code> with{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Accept: application/json</code> and suspends via React Suspense until resolved.
                All <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useServerData</code> calls within the same render share one request.
            </p>
            <h3 className="text-base font-semibold mt-4 mb-2">Options</h3>
            <table className="w-full text-sm text-muted-foreground mb-4">
                <thead><tr className="text-left border-b border-border"><th className="pb-2 pr-4">Option</th><th className="pb-2 pr-4">Type</th><th className="pb-2 pr-4">Default</th><th className="pb-2">Description</th></tr></thead>
                <tbody>
                    <tr className="border-b border-border/50"><td className="py-2 pr-4 font-mono text-xs">cache</td><td className="py-2 pr-4">boolean</td><td className="py-2 pr-4">true</td><td className="py-2">When <code className="bg-muted px-1 rounded">false</code>, the cached value is evicted when the component unmounts so the next mount fetches fresh data from the server. Safe with React Strict Mode.</td></tr>
                </tbody>
            </table>
            <Code>{`
// cache: false — next mount always fetches fresh data from the server
const uptime = useServerData(() => process.uptime(), { cache: false });
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">useGraphQL</h2>
            <Code lang="typescript">{`
// Typed — result.data shape is inferred from the DocumentNode
function useGraphQL<TData, TVariables>(
    query: HadarsDocumentNode<TData, TVariables>,
    variables?: TVariables,
): { data?: TData } | undefined

// Untyped fallback for plain query strings
function useGraphQL(
    query: string,
    variables?: Record<string, unknown>,
): { data?: Record<string, unknown> } | undefined
            `}</Code>
            <p className="text-muted-foreground mt-4">
                Executes a GraphQL query inside any component using the executor configured via{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">sources</code> or{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">graphql</code> in{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars.config.ts</code>.
                Integrates with <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useServerData</code> — the query runs on the server during SSR/export and is hydrated on the client at no extra cost.
                Returns <code className="text-sm bg-muted px-1.5 py-0.5 rounded">undefined</code> while pending. GraphQL errors throw, marking the page as failed during static export.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">loadModule</h2>
            <Code lang="typescript">{`
// Browser: becomes import('./path') — automatic code splitting
// Server:  becomes Promise.resolve(require('./path')) — statically bundled

const HeavyChart = React.lazy(() => loadModule<{ default: React.FC }>('./HeavyChart'));
            `}</Code>
            <p className="text-muted-foreground mt-4">
                Transformed at compile time by the hadars rspack loader. The module is included in
                the server bundle statically and downloaded on demand in the browser.
            </p>
            <p className="text-muted-foreground mt-3">
                <strong>The path must be a string literal</strong> at the <code>loadModule()</code> call
                site. Passing a variable prevents the loader from transforming the call — the module
                won't be bundled and build-time transforms (SWC plugins, etc.) won't run. If you use
                a helper, pass the factory function rather than the path string:
            </p>
            <Code lang="typescript">{`
// ✗ wrong — path is a variable, module is not bundled
const lazy = (path: string) => React.lazy(() => loadModule(path));
const Page = lazy('./Page');

// ✓ correct — literal sits at the loadModule() call site
type LazyFC = { default: React.ComponentType<any> };
const lazy = (fn: () => Promise<LazyFC>) => React.lazy(fn);
const Page = lazy(() => loadModule<LazyFC>('./Page'));
            `}</Code>
        </section>

        <footer className="mt-16 pt-8 text-center text-sm text-muted-foreground" style={{ borderTop: "1px solid oklch(0.68 0.28 285 / 0.15)" }}><p>hadars — MIT licence</p></footer>
    </>
);

export default ApiReference;
