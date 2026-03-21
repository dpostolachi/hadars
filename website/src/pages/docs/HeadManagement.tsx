import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

// Live demo components
const UseIdInput: React.FC<{ label: string }> = ({ label }) => {
    const id = React.useId();
    return (
        <div className="flex items-center gap-2">
            <label htmlFor={id} className="text-sm text-muted-foreground">{label}</label>
            <input id={id} type="text" placeholder={label} className="flex-1 h-7 px-2 rounded-md border border-border bg-muted text-sm font-mono" />
            <code className="text-xs text-muted-foreground">{id}</code>
        </div>
    );
};

const MultiIdDemo: React.FC = () => {
    const nameId = React.useId();
    const emailId = React.useId();
    return (
        <div className="flex flex-col gap-2">
            {[['Name', nameId, 'text'], ['Email', emailId, 'email']].map(([label, id, type]) => (
                <div key={id} className="flex items-center gap-2">
                    <label htmlFor={id} className="text-sm text-muted-foreground">{label}</label>
                    <input id={id} type={type} placeholder={label} className="flex-1 h-7 px-2 rounded-md border border-border bg-muted text-sm font-mono" />
                    <code className="text-xs text-muted-foreground">{id}</code>
                </div>
            ))}
        </div>
    );
};

const HeadManagement: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>Head Management — hadars</title>
            <meta name="description" content="Control title, meta, and link tags from any component using HadarsHead — no wrapper needed, no duplicates on navigation." />
            <meta property="og:title" content="Head Management — hadars" />
            <meta property="og:description" content="Control title, meta, and link tags from any component using HadarsHead — no wrapper needed, no duplicates on navigation." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">Head Management</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            <code className="text-sm bg-muted px-1.5 py-0.5 rounded">HadarsHead</code> controls <code className="text-sm bg-muted px-1.5 py-0.5 rounded">&lt;title&gt;</code>, <code className="text-sm bg-muted px-1.5 py-0.5 rounded">&lt;meta&gt;</code>,{' '}
            <code className="text-sm bg-muted px-1.5 py-0.5 rounded">&lt;link&gt;</code>, <code className="text-sm bg-muted px-1.5 py-0.5 rounded">&lt;script&gt;</code>, and <code className="text-sm bg-muted px-1.5 py-0.5 rounded">&lt;style&gt;</code> tags
            on both server and client without duplication.
        </p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Usage</h2>
            <p className="text-muted-foreground mb-4">
                Place <code className="text-sm bg-muted px-1.5 py-0.5 rounded">HadarsHead</code> anywhere in the component tree — no wrapper required.
                On the server it collects tags into the rendered HTML <code className="text-sm bg-muted px-1.5 py-0.5 rounded">&lt;head&gt;</code>.
                On the client it upserts them into <code className="text-sm bg-muted px-1.5 py-0.5 rounded">document.head</code>.
            </p>
            <Code>{`
import { HadarsHead } from 'hadars';

const Page = () => (
    <>
        <HadarsHead status={200}>
            <title>My page</title>
            <meta name="description" content="A great page" />
            <meta property="og:title" content="My page" />
            <meta property="og:image" content="https://example.com/og.png" />
            <meta httpEquiv="content-language" content="en" />
            <link rel="canonical" href="https://example.com/page" />
            <link rel="stylesheet" href="/styles/page.css" />
            <link rel="preload" href="/fonts/inter.woff2" as="font" crossOrigin="anonymous" />
            <style data-id="page-critical">{criticalCSS}</style>
            <script src="/vendor/analytics.js" async />
            <script data-id="inline-config" dangerouslySetInnerHTML={{ __html: 'var X=1' }} />
        </HadarsHead>
        ...
    </>
);
            `}</Code>
            <p className="text-muted-foreground mt-4">
                The optional <code className="text-sm bg-muted px-1.5 py-0.5 rounded">status</code> prop sets the HTTP response status code for that render.
                It only takes effect on the server — the last <code className="text-sm bg-muted px-1.5 py-0.5 rounded">HadarsHead</code> with a <code className="text-sm bg-muted px-1.5 py-0.5 rounded">status</code> prop wins.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Deduplication</h2>
            <p className="text-muted-foreground mb-4">
                Each element type has a natural dedup key derived from its identifying attributes.
                Rendering the same <code className="text-sm bg-muted px-1.5 py-0.5 rounded">HadarsHead</code> block in multiple components or across re-renders
                will not produce duplicate tags — the existing element is found and updated in place.
            </p>
            <div className="rounded-xl overflow-hidden divide-y mb-4" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.15)", boxShadow: "0 0 20px oklch(0.68 0.28 285 / 0.04)" }}>
                <div className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: "oklch(0.12 0.04 280)", color: "oklch(0.60 0.08 285)" }}>
                    <span>Element</span><span>Dedup key</span><span>Notes</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">&lt;title&gt;</code>
                    <span className="text-muted-foreground">singular</span>
                    <span className="text-muted-foreground">Always one title per page — last write wins.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">&lt;meta name&gt;</code>
                    <span className="text-muted-foreground"><code className="text-xs bg-muted px-1 rounded">name</code> value</span>
                    <span className="text-muted-foreground">e.g. <code className="text-xs bg-muted px-1 rounded">name="description"</code> — one per name.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">&lt;meta property&gt;</code>
                    <span className="text-muted-foreground"><code className="text-xs bg-muted px-1 rounded">property</code> value</span>
                    <span className="text-muted-foreground">e.g. Open Graph tags like <code className="text-xs bg-muted px-1 rounded">og:title</code>.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">&lt;meta httpEquiv&gt;</code>
                    <span className="text-muted-foreground"><code className="text-xs bg-muted px-1 rounded">http-equiv</code> value</span>
                    <span className="text-muted-foreground">Supports both <code className="text-xs bg-muted px-1 rounded">httpEquiv</code> and <code className="text-xs bg-muted px-1 rounded">http-equiv</code> casing.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">&lt;meta charSet&gt;</code>
                    <span className="text-muted-foreground">singular</span>
                    <span className="text-muted-foreground">One charset per page.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">&lt;link&gt;</code>
                    <span className="text-muted-foreground"><code className="text-xs bg-muted px-1 rounded">rel</code> + <code className="text-xs bg-muted px-1 rounded">href</code> (+ <code className="text-xs bg-muted px-1 rounded">as</code>)</span>
                    <span className="text-muted-foreground">Unique per URL. Without <code className="text-xs bg-muted px-1 rounded">href</code>, keyed by <code className="text-xs bg-muted px-1 rounded">rel</code> alone (e.g. preconnect).</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">&lt;script src&gt;</code>
                    <span className="text-muted-foreground"><code className="text-xs bg-muted px-1 rounded">src</code> URL</span>
                    <span className="text-muted-foreground">Unique per source URL.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">&lt;script data-id&gt;</code>
                    <span className="text-muted-foreground"><code className="text-xs bg-muted px-1 rounded">data-id</code> value</span>
                    <span className="text-muted-foreground">Required for inline scripts — see below.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">&lt;style data-id&gt;</code>
                    <span className="text-muted-foreground"><code className="text-xs bg-muted px-1 rounded">data-id</code> value</span>
                    <span className="text-muted-foreground">Required for inline styles — see below.</span>
                </div>
            </div>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">data-id for inline tags</h2>
            <p className="text-muted-foreground mb-4">
                Inline <code className="text-sm bg-muted px-1.5 py-0.5 rounded">&lt;script&gt;</code> (without <code className="text-sm bg-muted px-1.5 py-0.5 rounded">src</code>) and <code className="text-sm bg-muted px-1.5 py-0.5 rounded">&lt;style&gt;</code> elements
                have no natural URL to key on. Provide a <code className="text-sm bg-muted px-1.5 py-0.5 rounded">data-id</code> prop so hadars can find and update
                the same element across re-renders rather than appending a duplicate:
            </p>
            <Code>{`
<HadarsHead>
    {/* Critical CSS injected by your CSS-in-JS or build tool */}
    <style data-id="critical-css">{criticalStyles}</style>

    {/* Analytics or config snippet */}
    <script
        data-id="gtm-config"
        dangerouslySetInnerHTML={{ __html: gtmSnippet }}
    />
</HadarsHead>
            `}</Code>
            <p className="text-muted-foreground mt-4">
                Omitting <code className="text-sm bg-muted px-1.5 py-0.5 rounded">data-id</code> on inline elements triggers a <strong className="text-foreground">console warning</strong> at render time
                and falls back to append-only behaviour — safe for one-time static tags, but not for anything
                that re-renders or appears in multiple route components.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">useId() compatibility</h2>
            <p className="text-muted-foreground mb-4">
                hadars's SSR renderer (<code className="text-sm bg-muted px-1.5 py-0.5 rounded">slim-react</code>) generates <code className="text-sm bg-muted px-1.5 py-0.5 rounded">React.useId()</code> values
                that match what React produces on the client. The IDs below were produced on the server and
                must survive hydration without warnings.
            </p>
            <div className="rounded-xl divide-y overflow-hidden" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.2)", boxShadow: "0 0 24px oklch(0.68 0.28 285 / 0.06)" }}>
                <div className="flex items-start gap-4 px-4 py-3">
                    <span className="text-sm text-muted-foreground w-40 shrink-0">Single useId</span>
                    <span className="flex-1 text-sm">
                        <UseIdInput label="Username" />
                    </span>
                </div>
                <div className="flex items-start gap-4 px-4 py-3">
                    <span className="text-sm text-muted-foreground w-40 shrink-0">Multiple calls</span>
                    <span className="flex-1 text-sm">
                        <MultiIdDemo />
                    </span>
                </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3 italic">
                Open the browser console — no hydration mismatch warnings means slim-react and React
                agree on every ID.
            </p>
        </section>

        <footer className="mt-16 pt-8 text-center text-sm text-muted-foreground" style={{ borderTop: "1px solid oklch(0.68 0.28 285 / 0.15)" }}><p>hadars — MIT licence</p></footer>
    </>
);

export default HeadManagement;
