import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const SlimReact: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>slim-react — hadars</title>
            <meta name="description" content="slim-react is hadars's lightweight React-compatible SSR renderer — no react-dom/server required, smaller bundle size." />
            <meta property="og:title" content="slim-react — hadars" />
            <meta property="og:description" content="slim-react is hadars's lightweight React-compatible SSR renderer — no react-dom/server required, smaller bundle size." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">slim-react</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            hadars's lightweight React-compatible SSR renderer — no <code className="text-sm bg-muted px-1.5 py-0.5 rounded">react-dom/server</code> required.
        </p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">What it is</h2>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">slim-react</code> is hadars's own server-side renderer, located in{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">src/slim-react/</code>. It replaces <code className="text-sm bg-muted px-1.5 py-0.5 rounded">react-dom/server</code> entirely on
                the server side. Your components and any libraries they import render through it
                automatically — no code changes required.
            </p>
            <p className="text-muted-foreground">
                For SSR builds, rspack aliases <code className="text-sm bg-muted px-1.5 py-0.5 rounded">react</code> and <code className="text-sm bg-muted px-1.5 py-0.5 rounded">react/jsx-runtime</code>{' '}
                to slim-react, so third-party components render through it transparently.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">How it works</h2>
            <div className="flex flex-col sm:flex-row items-stretch gap-2 mb-4">
                <div className="flex-1 rounded-xl p-4 flex flex-col gap-1" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.15)" }}>
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold mb-1">1</span>
                    <strong className="text-sm">render(element)</strong>
                    <span className="text-xs text-muted-foreground">Walks the React element tree recursively, calling function components and resolving JSX.</span>
                </div>
                <div className="text-muted-foreground flex items-center justify-center text-xl px-1">→</div>
                <div className="flex-1 rounded-xl p-4 flex flex-col gap-1" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.15)" }}>
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold mb-1">2</span>
                    <strong className="text-sm">Suspense loop</strong>
                    <span className="text-xs text-muted-foreground">Thrown Promises are caught, awaited, and the component is retried. Repeats until all data resolves.</span>
                </div>
                <div className="text-muted-foreground flex items-center justify-center text-xl px-1">→</div>
                <div className="flex-1 rounded-xl p-4 flex flex-col gap-1" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.15)" }}>
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold mb-1">3</span>
                    <strong className="text-sm">HTML string</strong>
                    <span className="text-xs text-muted-foreground">Returns the fully resolved HTML string, compatible with React's <code className="text-xs bg-muted px-1 rounded">hydrateRoot</code>.</span>
                </div>
            </div>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Supported React features</h2>
            <div className="rounded-xl overflow-hidden divide-y" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.15)", boxShadow: "0 0 20px oklch(0.68 0.28 285 / 0.04)" }}>
                <div className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: "oklch(0.12 0.04 280)", color: "oklch(0.60 0.08 285)" }}>
                    <span>Feature</span><span>Status</span><span>Notes</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">React.memo</code><span className="text-emerald-500">✓</span>
                    <span className="text-muted-foreground">Wrapped components render normally.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">React.forwardRef</code><span className="text-emerald-500">✓</span>
                    <span className="text-muted-foreground">Refs are ignored on the server (no DOM), render proceeds.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">React.lazy</code><span className="text-emerald-500">✓</span>
                    <span className="text-muted-foreground">The lazy promise is awaited before rendering.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">Context.Provider</code><span className="text-emerald-500">✓</span>
                    <span className="text-muted-foreground">Full context propagation through the tree.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">Context.Consumer</code><span className="text-emerald-500">✓</span>
                    <span className="text-muted-foreground">Reads the nearest Provider value.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">React.Suspense</code><span className="text-emerald-500">✓</span>
                    <span className="text-muted-foreground">Thrown Promises are awaited and the component is retried.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">async components</code><span className="text-emerald-500">✓</span>
                    <span className="text-muted-foreground">Async function components are awaited directly.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">React.useId()</code><span className="text-emerald-500">✓</span>
                    <span className="text-muted-foreground">Generates tree-position-based IDs matching React's client output.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">useState / useEffect</code><span className="text-amber-500">partial</span>
                    <span className="text-muted-foreground"><code className="text-xs bg-muted px-1 rounded">useState</code> returns the initial value. <code className="text-xs bg-muted px-1 rounded">useEffect</code> is a no-op on the server.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">useRef / useCallback / useMemo</code><span className="text-amber-500">partial</span>
                    <span className="text-muted-foreground">Return the initial value or identity — no caching between renders.</span>
                </div>
            </div>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">useId() compatibility</h2>
            <p className="text-muted-foreground mb-4">
                slim-react implements React 19's tree-position-based <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useId</code> algorithm.
                IDs are derived from the component's position in the render tree, so they are
                deterministic across the server render and client hydration.
            </p>
            <p className="text-muted-foreground mb-4">
                When your components call <code className="text-sm bg-muted px-1.5 py-0.5 rounded">React.useId()</code>, slim-react intercepts the call
                via a dispatcher shim and routes it through the same algorithm, producing IDs that
                React's <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hydrateRoot</code> will agree with — no hydration warnings.
            </p>
            <Code>{`
// Works in any component during SSR — no special imports needed
const FormField = ({ label }) => {
    const id = React.useId(); // slim-react handles this during SSR
    return (
        <>
            <label htmlFor={id}>{label}</label>
            <input id={id} />
        </>
    );
};
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Emotion / CSS-in-JS</h2>
            <p className="text-muted-foreground">
                Because slim-react renders through the same React component model, CSS-in-JS
                libraries like <code className="text-sm bg-muted px-1.5 py-0.5 rounded">@emotion/styled</code> and <code className="text-sm bg-muted px-1.5 py-0.5 rounded">@emotion/react</code> work
                out of the box — styles are inlined into the rendered HTML on the server, and
                the client hydrates without a flash of unstyled content.
            </p>
        </section>

        <footer className="mt-16 pt-8 text-center text-sm text-muted-foreground" style={{ borderTop: "1px solid oklch(0.68 0.28 285 / 0.15)" }}><p>hadars — MIT licence</p></footer>
    </>
);

export default SlimReact;
