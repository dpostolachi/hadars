import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const CloudflareDeployment: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>Cloudflare Workers — hadars</title>
            <meta name="description" content="Deploy hadars as a Cloudflare Worker with a single command. SSR at the edge, static assets on R2." />
            <meta property="og:title" content="Cloudflare Workers — hadars" />
            <meta property="og:description" content="Deploy hadars as a Cloudflare Worker with a single command. SSR at the edge, static assets on R2." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">Cloudflare Workers</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            Bundle your hadars app into a single self-contained Worker script and deploy to Cloudflare's global edge network.
            SSR runs in the Worker; JS, CSS, and other static assets are served from R2 or a CDN.
        </p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">How it works</h2>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars export cloudflare</code> runs your production
                build and then uses esbuild to bundle the SSR module, HTML template, and all runtime dependencies
                into a single <code className="text-sm bg-muted px-1.5 py-0.5 rounded">cloudflare.mjs</code>.
                The Worker receives standard Web <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Request</code> objects
                and returns <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Response</code> objects — no event format
                conversion needed.
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
                    ['HTML rendering (SSR)', 'Cloudflare Worker'],
                    ['JS / CSS bundles', 'R2 bucket (or CDN)'],
                    ['User static files', 'R2 bucket (or CDN)'],
                    ['API routes (fetch hook)', 'Cloudflare Worker'],
                    ['Cache', 'hadars cache config (in-Worker)'],
                ].map(([r, h]) => (
                    <div key={r} className="grid grid-cols-2 gap-4 px-4 py-3 text-sm">
                        <span className="text-muted-foreground">{r}</span>
                        <span className="text-foreground/80">{h}</span>
                    </div>
                ))}
            </div>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">1 — Bundle the Worker</h2>
            <p className="text-muted-foreground mb-4">
                Run this from your project root. It builds the app first, then produces{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">cloudflare.mjs</code> in the same directory.
            </p>
            <Code lang="bash">{`
hadars export cloudflare

# Custom output path
hadars export cloudflare dist/worker.mjs
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">2 — Upload static assets to R2</h2>
            <p className="text-muted-foreground mb-4">
                Build artifacts in <code className="text-sm bg-muted px-1.5 py-0.5 rounded">.hadars/static/</code> are
                content-hashed and safe to cache indefinitely. Your own files in{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">static/</code> use a shorter TTL.
                Skip <code className="text-sm bg-muted px-1.5 py-0.5 rounded">out.html</code> — that's the SSR template
                used by the Worker at runtime, not a public file.
            </p>
            <Code lang="bash">{`
# Upload build output — content-hashed, safe for long-term caching
wrangler r2 object put my-bucket/ \\
    --file .hadars/static/ \\
    --recursive \\
    --cache-control "public, max-age=31536000, immutable"

# Upload your own static files
wrangler r2 object put my-bucket/ \\
    --file static/ \\
    --recursive \\
    --cache-control "public, max-age=3600"
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">3 — Configure wrangler.toml</h2>
            <p className="text-muted-foreground mb-4">
                Point <code className="text-sm bg-muted px-1.5 py-0.5 rounded">main</code> at your bundle, bind the R2 bucket,
                and add routing rules so static file requests go to R2 and everything else goes to the Worker.
            </p>
            <Code lang="toml">{`
name = "my-app"
main = "cloudflare.mjs"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "my-bucket"

# Route static assets to R2 — the Worker only handles HTML + API requests.
# Adjust the patterns to match your asset extensions.
[[rules]]
type = "ESModule"
globs = ["**/*.mjs"]

[[routes]]
pattern = "example.com/*.js"
zone_name = "example.com"

[[routes]]
pattern = "example.com/*.css"
zone_name = "example.com"
            `}</Code>
            <p className="text-muted-foreground mt-3 text-sm">
                Alternatively use a Cloudflare Cache Rule or R2 public bucket with a custom domain to serve all static
                extensions without listing each one in <code className="text-sm bg-muted px-1.5 py-0.5 rounded">wrangler.toml</code>.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">4 — Deploy</h2>
            <Code lang="bash">{`
wrangler deploy
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Manual entry shim</h2>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars export cloudflare</code> generates and bundles
                an entry shim automatically. If you prefer to manage the bundling step yourself (e.g. to integrate with an
                existing esbuild or Vite pipeline), write the shim by hand:
            </p>
            <Code lang="typescript">{`
// worker.ts — your Worker entry point
import * as ssrModule from './.hadars/index.ssr.js';
import outHtml from './.hadars/static/out.html';
import { createCloudflareHandler } from 'hadars/cloudflare';
import config from './hadars.config';

export default createCloudflareHandler(config, { ssrModule, outHtml });
            `}</Code>
            <p className="text-muted-foreground mt-3 mb-3">Then bundle it yourself:</p>
            <Code lang="bash">{`
esbuild worker.ts \\
    --bundle \\
    --platform=browser \\
    --format=esm \\
    --target=es2022 \\
    --outfile=cloudflare.mjs \\
    --loader:.html=text \\
    --external:@rspack/*
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">CPU time limit</h2>
            <p className="text-muted-foreground mb-4">
                Cloudflare Workers on the free plan have a 10 ms CPU time limit per request. hadars uses{' '}
                <a href="/docs/slim-react" className="text-primary underline underline-offset-2">slim-react</a> for SSR
                which is synchronous and typically renders a page in under 3 ms, well within the budget. Paid plans
                (Workers Paid) have no CPU time limit. If you hit the limit, upgrade the plan or reduce the
                complexity of the initial render.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Local development</h2>
            <p className="text-muted-foreground mb-4">
                Use <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars dev</code> for local development with
                full HMR — you don't need wrangler for day-to-day work. When you want to test the Worker bundle
                specifically, use Wrangler's local mode:
            </p>
            <Code lang="bash">{`
# Normal development (recommended)
hadars dev

# Test the bundled Worker locally
hadars export cloudflare && wrangler dev cloudflare.mjs
            `}</Code>
        </section>

        <div style={{ borderTop: '1px solid oklch(0.68 0.28 285 / 0.15)', paddingTop: '2rem', marginTop: '2rem' }}>
            <p className="text-sm text-muted-foreground">
                Also deploying to AWS?{' '}
                <a href="/docs/deployment" className="text-primary underline underline-offset-2">See the Deployment page</a>{' '}
                for Lambda and production server instructions.
            </p>
        </div>
    </>
);

export default CloudflareDeployment;
