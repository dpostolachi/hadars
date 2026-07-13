import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const BunnyDeployment: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>Bunny.net Edge Scripting — hadars</title>
            <meta name="description" content="Deploy hadars as a bunny.net Edge Script with a single command. SSR at the edge, static assets on bunny.net Storage." />
            <meta property="og:title" content="Bunny.net Edge Scripting — hadars" />
            <meta property="og:description" content="Deploy hadars as a bunny.net Edge Script with a single command. SSR at the edge, static assets on bunny.net Storage." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">Bunny.net Edge Scripting</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            Bundle your hadars app into a single self-contained edge script and deploy to bunny.net's global CDN network.
            SSR runs in the script; JS, CSS, and other static assets are served from bunny.net Storage.
        </p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">How it works</h2>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars export bunny</code> runs your production
                build and then uses esbuild to bundle the SSR module, HTML template, and all runtime dependencies
                into a single <code className="text-sm bg-muted px-1.5 py-0.5 rounded">bunny.mjs</code>.
                Bunny.net edge scripts run on Deno + V8 and use the standard Web{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Request</code> /{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Response</code> API — no event format
                conversion is needed.
            </p>
            <div
                className="rounded-xl overflow-hidden divide-y mb-4"
                style={{ background: 'oklch(0.08 0.025 280)', border: '1px solid oklch(0.68 0.28 285 / 0.15)' }}
            >
                <div
                    className="grid grid-cols-2 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'oklch(0.12 0.04 280)', color: 'oklch(0.60 0.08 285)' }}
                >
                    <span>Responsibility</span><span>Handled by</span>
                </div>
                {[
                    ['HTML rendering (SSR)', 'Bunny Edge Script'],
                    ['JS / CSS bundles', 'bunny.net Storage (or CDN)'],
                    ['User static files', 'bunny.net Storage (or CDN)'],
                    ['API routes (fetch hook)', 'Bunny Edge Script'],
                    ['Cache', 'hadars cache config (in-script)'],
                ].map(([r, h]) => (
                    <div key={r} className="grid grid-cols-2 gap-4 px-4 py-3 text-sm">
                        <span className="text-muted-foreground">{r}</span>
                        <span className="text-foreground/80">{h}</span>
                    </div>
                ))}
            </div>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">1 — Bundle the edge script</h2>
            <p className="text-muted-foreground mb-4">
                Run this from your project root. It builds the app first, then produces{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">bunny.mjs</code> in the same directory.
            </p>
            <Code lang="bash">{`
hadars export bunny

# Custom output path
hadars export bunny dist/script.mjs
            `}</Code>
            <p className="text-muted-foreground mt-3 text-sm">
                The command runs <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars build</code>, writes a
                temporary entry shim that statically imports the SSR module and HTML template, then bundles
                everything with esbuild (<code className="text-sm bg-muted px-1.5 py-0.5 rounded">platform: browser</code>,{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">format: esm</code>,{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">target: es2022</code>).
                The <code className="text-sm bg-muted px-1.5 py-0.5 rounded">@bunny.net/edgescript-sdk</code> is marked
                external — it is always available in the bunny.net Deno runtime and must not be bundled.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">2 — Upload static assets to Storage</h2>
            <p className="text-muted-foreground mb-4">
                Build artifacts in <code className="text-sm bg-muted px-1.5 py-0.5 rounded">.hadars/static/</code> are
                content-hashed and safe to cache indefinitely. Your own files in{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">static/</code> use a shorter TTL.
                Skip <code className="text-sm bg-muted px-1.5 py-0.5 rounded">out.html</code> — that's the SSR template
                used by the script at runtime, not a public file.
            </p>
            <Code lang="bash">{`
# Upload build output via the bunny.net Storage API or dashboard
# Content-hashed filenames are safe for indefinite caching
curl -X PUT "https://storage.bunnycdn.com/my-zone/.hadars/static/" \\
    -H "AccessKey: $BUNNY_STORAGE_KEY" \\
    --data-binary @.hadars/static/

# Or use the bunny.net CLI / dashboard file manager to upload
# the contents of .hadars/static/ and static/ to your storage zone.
            `}</Code>
            <p className="text-muted-foreground mt-3 text-sm">
                Connect the storage zone to a pull zone (CDN) and configure it to serve requests for static
                file extensions (<code className="text-sm bg-muted px-1.5 py-0.5 rounded">*.js</code>,{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">*.css</code>,{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">*.woff2</code>, etc.) while routing
                all other requests to the edge script.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">3 — Create the edge script</h2>
            <ol className="text-muted-foreground text-sm pl-6 mb-4 leading-loose list-decimal">
                <li>
                    In the{' '}
                    <a
                        href="https://dash.bunny.net"
                        className="text-primary underline underline-offset-2"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        bunny.net dashboard
                    </a>
                    , go to <strong className="text-foreground">Edge Platform › Scripting</strong> and click{' '}
                    <strong className="text-foreground">Add Script</strong>.
                </li>
                <li>Select <strong className="text-foreground">Standalone</strong> as the script type.</li>
                <li>Paste the contents of <code className="text-xs bg-muted px-1 rounded">bunny.mjs</code> into the editor (or connect your GitHub repository for CI/CD).</li>
                <li>Click <strong className="text-foreground">Save</strong> and <strong className="text-foreground">Publish</strong>.</li>
            </ol>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Manual entry shim</h2>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars export bunny</code> generates and bundles
                an entry shim automatically. If you prefer to manage the bundling step yourself, write the shim by hand:
            </p>
            <Code lang="typescript">{`
// script.ts — your Bunny edge script entry point
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import * as ssrModule from './.hadars/index.ssr.js';
import outHtml from './.hadars/static/out.html';
import { createBunnyHandler } from 'hadars/bunny';
import config from './hadars.config';

BunnySDK.net.http.serve(createBunnyHandler(config, { ssrModule, outHtml }));
            `}</Code>
            <p className="text-muted-foreground mt-3 mb-3">Then bundle it yourself:</p>
            <Code lang="bash">{`
esbuild script.ts \\
    --bundle \\
    --platform=browser \\
    --format=esm \\
    --target=es2022 \\
    --outfile=bunny.mjs \\
    --loader:.html=text \\
    --external:@rspack/* \\
    --external:@bunny.net/edgescript-sdk
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">createBunnyHandler API</h2>
            <Code lang="typescript">{`
import { createBunnyHandler, type BunnyBundled } from 'hadars/bunny';
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import * as ssrModule from './.hadars/index.ssr.js';
import outHtml from './.hadars/static/out.html';
import config from './hadars.config';

// createBunnyHandler returns a standard (request: Request) => Promise<Response> function.
// Pass it directly to BunnySDK.net.http.serve.
BunnySDK.net.http.serve(createBunnyHandler(config, { ssrModule, outHtml }));
            `}</Code>
            <div
                className="rounded-xl overflow-hidden divide-y mt-4"
                style={{ background: 'oklch(0.08 0.025 280)', border: '1px solid oklch(0.68 0.28 285 / 0.15)' }}
            >
                <div
                    className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'oklch(0.12 0.04 280)', color: 'oklch(0.60 0.08 285)' }}
                >
                    <span>Parameter</span><span>Type</span><span>Description</span>
                </div>
                {[
                    ['options', 'HadarsOptions', 'Same config object used for dev/run'],
                    ['bundled', 'BunnyBundled', 'Pre-loaded SSR module + HTML template'],
                ].map(([p, t, d]) => (
                    <div key={p} className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                        <code className="text-primary text-xs">{p}</code>
                        <code className="text-muted-foreground text-xs">{t}</code>
                        <span className="text-muted-foreground">{d}</span>
                    </div>
                ))}
            </div>
            <p className="text-muted-foreground mt-4 text-sm">
                The returned handler is a plain <code className="text-xs bg-muted px-1 rounded">(request: Request) {'=> Promise<Response>'}</code>{' '}
                function — compatible with any Web API environment, not just bunny.net.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Local development</h2>
            <p className="text-muted-foreground mb-4">
                Use <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars dev</code> for local development with
                full HMR. When you want to test the bundled edge script specifically, run it with Deno:
            </p>
            <Code lang="bash">{`
# Normal development (recommended)
hadars dev

# Build and test the bundled script locally with Deno
hadars export bunny && deno run -A bunny.mjs
            `}</Code>
        </section>

        <div style={{ borderTop: '1px solid oklch(0.68 0.28 285 / 0.15)', paddingTop: '2rem', marginTop: '2rem' }}>
            <p className="text-sm text-muted-foreground">
                Also deploying to AWS or Cloudflare?{' '}
                <a href="/docs/deployment" className="text-primary underline underline-offset-2">Lambda / production server</a>
                {' '}·{' '}
                <a href="/docs/cloudflare" className="text-primary underline underline-offset-2">Cloudflare Workers</a>
            </p>
        </div>
    </>
);

export default BunnyDeployment;
