import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const Routing: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>Routing — hadars</title>
            <meta name="description" content="hadars has no built-in router — bring react-router, TanStack Router, or any other. Here's how SSR routing works." />
            <meta property="og:title" content="Routing — hadars" />
            <meta property="og:description" content="hadars has no built-in router — bring react-router, TanStack Router, or any other. Here's how SSR routing works." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">Routing</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            hadars doesn't include a router — bring your own. Any router that works with React SSR
            will work. This page shows how to set up <code className="text-sm bg-muted px-1.5 py-0.5 rounded">react-router-dom</code> v6.
        </p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">How it works</h2>
            <p className="text-muted-foreground mb-4">
                The server renders a single App component for every URL. hadars passes the current
                request URL as the <code className="text-sm bg-muted px-1.5 py-0.5 rounded">location</code> prop (via <code className="text-sm bg-muted px-1.5 py-0.5 rounded">getInitProps</code> or
                directly from the framework). Your router reads that location and renders the
                matching page — same on server and client.
            </p>
            <p className="text-muted-foreground mb-4">
                react-router-dom v6 provides two router components for this:
            </p>
            <div className="rounded-xl overflow-hidden divide-y mb-4" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.15)", boxShadow: "0 0 20px oklch(0.68 0.28 285 / 0.04)" }}>
                <div className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: "oklch(0.12 0.04 280)", color: "oklch(0.60 0.08 285)" }}>
                    <span>Component</span><span>Used on</span><span>Why</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">StaticRouter</code>
                    <span className="text-muted-foreground">server</span>
                    <span className="text-muted-foreground">Reads location from a prop — no <code className="text-xs bg-muted px-1 rounded">window</code> required.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">BrowserRouter</code>
                    <span className="text-muted-foreground">client</span>
                    <span className="text-muted-foreground">Reads from <code className="text-xs bg-muted px-1 rounded">window.location</code> and listens to History API events.</span>
                </div>
            </div>
            <p className="text-muted-foreground">
                Because both routers resolve to the same URL (and therefore the same page component),
                the rendered DOM is identical and React's <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hydrateRoot</code> succeeds without warnings.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Installation</h2>
            <Code lang="bash">npm install react-router-dom</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">App.tsx setup</h2>
            <p className="text-muted-foreground mb-4">
                Detect server vs client with <code className="text-sm bg-muted px-1.5 py-0.5 rounded">typeof window === 'undefined'</code> and render
                the appropriate router. The <code className="text-sm bg-muted px-1.5 py-0.5 rounded">location</code> prop comes from the hadars App
                contract — it equals <code className="text-sm bg-muted px-1.5 py-0.5 rounded">req.pathname + req.search</code> from the incoming request.
            </p>
            <Code>{`
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { type HadarsApp, type HadarsRequest } from 'hadars';

import Home from './pages/Home';
import About from './pages/About';
import Blog from './pages/Blog';
import NotFound from './pages/NotFound';

interface Props {
    serverTime: string;
}

const AppRoutes: React.FC<Props> = (props) => (
    <Routes>
        <Route path="/" element={<Home {...props} />} />
        <Route path="/about" element={<About />} />
        <Route path="/blog/:slug" element={<Blog />} />
        <Route path="*" element={<NotFound />} />
    </Routes>
);

const App: HadarsApp<Props> = ({ location, ...props }) => {
    const routes = <AppRoutes {...props} />;

    if (typeof window === 'undefined') {
        // Server — location comes from the incoming request
        return <StaticRouter location={location}>{routes}</StaticRouter>;
    }

    // Client — reads from window.location, listens to History API
    return <BrowserRouter>{routes}</BrowserRouter>;
};

export const getInitProps = async (_req: HadarsRequest): Promise<Props> => ({
    serverTime: new Date().toISOString(),
});

export default App;
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Navigation</h2>
            <p className="text-muted-foreground mb-4">
                Use react-router-dom's <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Link</code> and <code className="text-sm bg-muted px-1.5 py-0.5 rounded">NavLink</code> for client-side
                navigation — they call <code className="text-sm bg-muted px-1.5 py-0.5 rounded">history.pushState</code> internally, which BrowserRouter
                intercepts to re-render without a full page reload.
            </p>
            <Code>{`
import { Link, NavLink } from 'react-router-dom';

const Nav = () => (
    <nav>
        {/* NavLink adds an "active" class when the route matches */}
        <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
            Home
        </NavLink>
        <NavLink to="/about" className={({ isActive }) => isActive ? 'active' : ''}>
            About
        </NavLink>

        {/* Link for plain navigation without active state */}
        <Link to="/blog/hello-world">Read post</Link>
    </nav>
);
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Reading route params</h2>
            <p className="text-muted-foreground mb-4">
                Use <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useParams</code> inside any component rendered by a <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Route</code>.
                During SSR, slim-react renders the correct route via StaticRouter, so the params
                are available server-side too.
            </p>
            <Code>{`
import { useParams } from 'react-router-dom';
import { useServerData } from 'hadars';

const Blog: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();

    const post = useServerData(() => db.getPost(slug!));
    if (!post) return null;

    return (
        <article>
            <h1>{post.title}</h1>
            <p>{post.body}</p>
        </article>
    );
};
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">404 pages</h2>
            <p className="text-muted-foreground mb-4">
                Use a wildcard <code className="text-sm bg-muted px-1.5 py-0.5 rounded">path="*"</code> route for unmatched URLs. Set the HTTP status
                code to 404 with <code className="text-sm bg-muted px-1.5 py-0.5 rounded">HadarsHead status={404}</code>:
            </p>
            <Code>{`
import { HadarsHead } from 'hadars';

const NotFound: React.FC = () => (
    <>
        <HadarsHead status={404}>
            <title>404 — Page not found</title>
        </HadarsHead>
        <h1>Page not found</h1>
    </>
);

// In AppRoutes:
<Route path="*" element={<NotFound />} />
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Nested layouts</h2>
            <p className="text-muted-foreground mb-4">
                Use react-router-dom's nested routes with <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Outlet</code> for shared layouts
                (e.g. a sidebar that only appears on doc pages):
            </p>
            <Code>{`
import { Outlet } from 'react-router-dom';

const DocsLayout: React.FC = () => (
    <div style={{ display: 'flex' }}>
        <aside style={{ width: 220 }}>
            <NavLink to="/docs/getting-started">Getting Started</NavLink>
            <NavLink to="/docs/api">API Reference</NavLink>
        </aside>
        <main style={{ flex: 1 }}>
            <Outlet /> {/* child routes render here */}
        </main>
    </div>
);

// In AppRoutes:
<Route path="/docs" element={<DocsLayout />}>
    <Route path="getting-started" element={<GettingStarted />} />
    <Route path="api" element={<ApiReference />} />
</Route>
            `}</Code>
        </section>

        <footer className="mt-16 pt-8 text-center text-sm text-muted-foreground" style={{ borderTop: "1px solid oklch(0.68 0.28 285 / 0.15)" }}><p>hadars — MIT licence</p></footer>
    </>
);

export default Routing;
