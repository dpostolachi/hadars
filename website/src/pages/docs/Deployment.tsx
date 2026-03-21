import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const Deployment: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>Deployment — hadars</title>
            <meta name="description" content="Deploy hadars on Node.js, Bun, or AWS Lambda. Serve static assets from S3 + CloudFront for production." />
            <meta property="og:title" content="Deployment — hadars" />
            <meta property="og:description" content="Deploy hadars on Node.js, Bun, or AWS Lambda. Serve static assets from S3 + CloudFront for production." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">Deployment</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            Deploy hadars apps to any Node.js host, Bun server, or AWS Lambda.
        </p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Production server</h2>
            <Code lang="bash">{`
# Build client + SSR bundles
hadars build

# Start the production server
hadars run
            `}</Code>
            <p className="text-muted-foreground mt-4 mb-4">
                Files in <code className="text-sm bg-muted px-1.5 py-0.5 rounded">static/</code> at your project root are served as-is (images, fonts,
                robots.txt, etc.). Build output — JS bundles, CSS, the HTML template — lands in{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">.hadars/static/</code> and is served the same way. No extra config needed for either.
            </p>
            <p className="text-muted-foreground mt-4">
                For multi-core usage, set <code className="text-sm bg-muted px-1.5 py-0.5 rounded">workers: os.cpus().length</code> in your config.
                hadars forks one process per worker via <code className="text-sm bg-muted px-1.5 py-0.5 rounded">node:cluster</code>. Each worker is
                an independent HTTP server sharing the same port.
            </p>
            <Code lang="typescript">{`
import os from 'os';
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    port: 3000,
    workers: os.cpus().length,
};

export default config;
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">AWS Lambda</h2>
            <p className="text-muted-foreground mb-4">hadars apps run on AWS Lambda backed by API Gateway (HTTP API v2 or REST API v1).</p>

            <h3 className="text-lg font-semibold mb-3 text-gradient-soft">File-based deployment</h3>
            <p className="text-muted-foreground mb-4">
                Run <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars build</code>, then create a Lambda entry file that imports{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">createLambdaHandler</code>:
            </p>
            <Code lang="typescript">{`
// lambda-entry.ts
import { createLambdaHandler } from 'hadars/lambda';
import config from './hadars.config';

export const handler = createLambdaHandler(config);
            `}</Code>
            <p className="text-muted-foreground mt-4">
                Deploy the entire project directory (including the <code className="text-sm bg-muted px-1.5 py-0.5 rounded">.hadars/</code> output folder)
                as your Lambda package. For production, front the function with CloudFront and route
                static paths from <code className="text-sm bg-muted px-1.5 py-0.5 rounded">.hadars/static/</code> to an S3 origin.
            </p>

            <h3 className="text-lg font-semibold mb-3 mt-6">Single-file bundle</h3>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars export lambda</code> produces a completely self-contained <code className="text-sm bg-muted px-1.5 py-0.5 rounded">.mjs</code>{' '}
                file that requires no <code className="text-sm bg-muted px-1.5 py-0.5 rounded">.hadars/</code> directory on disk. The SSR module and HTML
                template are inlined at build time.
            </p>
            <Code lang="bash">{`
# Outputs lambda.mjs in the current directory
hadars export lambda

# Custom output path
hadars export lambda dist/lambda.mjs
            `}</Code>
            <p className="text-muted-foreground mt-4">The command:</p>
            <ol className="text-muted-foreground text-sm pl-6 mb-4 leading-loose list-decimal">
                <li>Runs <code className="text-xs bg-muted px-1 rounded">hadars build</code></li>
                <li>Generates a temporary entry shim with static imports of the SSR module and <code className="text-xs bg-muted px-1 rounded">out.html</code></li>
                <li>Bundles everything into a single ESM <code className="text-xs bg-muted px-1 rounded">.mjs</code> with esbuild</li>
            </ol>
            <p className="text-muted-foreground mb-2"><strong className="text-foreground">Deploy steps:</strong></p>
            <ol className="text-muted-foreground text-sm pl-6 mb-4 leading-loose list-decimal">
                <li>Upload the output <code className="text-xs bg-muted px-1 rounded">.mjs</code> as your Lambda function code</li>
                <li>Set the handler to <code className="text-xs bg-muted px-1 rounded">index.handler</code></li>
                <li>Upload <code className="text-xs bg-muted px-1 rounded">.hadars/static/</code> assets to S3 and serve via CloudFront</li>
            </ol>

            <h3 className="text-lg font-semibold mb-3 mt-6">Bundled API</h3>
            <Code lang="typescript">{`
import { createLambdaHandler, type LambdaBundled } from 'hadars/lambda';

// File-based (reads .hadars/ at runtime)
export const handler = createLambdaHandler(config);

// Bundled — zero I/O, for use with 'hadars export lambda' output
import * as ssrModule from './.hadars/index.ssr.js';
import outHtml from './.hadars/static/out.html';
export const handler = createLambdaHandler(config, { ssrModule, outHtml });
            `}</Code>
            <p className="text-muted-foreground mt-4">
                The handler accepts both API Gateway HTTP API (v2) and REST API (v1) event formats.
                Binary responses (images, fonts, pre-compressed assets) are base64-encoded automatically.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Static assets on S3 + CloudFront</h2>
            <p className="text-muted-foreground mb-4">
                By default hadars serves JS bundles, CSS, and your <code className="text-sm bg-muted px-1.5 py-0.5 rounded">static/</code> files
                from the same process as SSR. For production you'll want to offload them — upload to S3 and
                route asset requests through CloudFront so Lambda only handles HTML rendering.
            </p>

            <h3 className="text-lg font-semibold mb-3 text-gradient-soft">1 — Upload to S3</h3>
            <p className="text-muted-foreground mb-4">
                Build first, then sync both output directories. Build artifacts are content-hashed
                so they can be cached indefinitely. Skip <code className="text-sm bg-muted px-1.5 py-0.5 rounded">out.html</code> — that's
                the SSR template used by Lambda at runtime, not a file browsers should fetch directly.
            </p>
            <Code lang="bash">{`
# Build client + SSR bundles
hadars build

# Upload build output — safe for long cache (content-hashed filenames)
aws s3 sync .hadars/static/ s3://your-bucket/ \\
    --exclude "out.html" \\
    --cache-control "public, max-age=31536000, immutable"

# Upload your own static files — shorter cache for files that may change
aws s3 sync static/ s3://your-bucket/ \\
    --cache-control "public, max-age=3600"
            `}</Code>

            <h3 className="text-lg font-semibold mb-3 mt-6 text-gradient-soft">2 — CloudFront distribution</h3>
            <p className="text-muted-foreground mb-4">
                Set up two origins and use path-pattern behaviours to split traffic:
            </p>
            <div
                className="rounded-xl overflow-hidden divide-y mb-4"
                style={{ background: 'oklch(0.08 0.025 280)', border: '1px solid oklch(0.68 0.28 285 / 0.15)' }}
            >
                <div
                    className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'oklch(0.12 0.04 280)', color: 'oklch(0.60 0.08 285)' }}
                >
                    <span>Origin</span><span>Type</span><span>Purpose</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary text-xs">S3 bucket</code>
                    <span className="text-muted-foreground">S3 (OAC)</span>
                    <span className="text-muted-foreground">JS, CSS, fonts, images, robots.txt</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary text-xs">API Gateway / Lambda URL</code>
                    <span className="text-muted-foreground">HTTP</span>
                    <span className="text-muted-foreground">SSR — all other requests</span>
                </div>
            </div>
            <p className="text-muted-foreground mb-3">Add a behaviour for each static file extension pointing to the S3 origin, and leave the default behaviour (<code className="text-sm bg-muted px-1.5 py-0.5 rounded">*</code>) pointing to Lambda:</p>
            <div
                className="rounded-xl overflow-hidden divide-y mb-4"
                style={{ background: 'oklch(0.08 0.025 280)', border: '1px solid oklch(0.68 0.28 285 / 0.15)' }}
            >
                <div
                    className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'oklch(0.12 0.04 280)', color: 'oklch(0.60 0.08 285)' }}
                >
                    <span>Path pattern</span><span>Origin</span><span>Cache TTL</span>
                </div>
                {[
                    ['*.js', 'S3', '1 year (content-hashed)'],
                    ['*.css', 'S3', '1 year (content-hashed)'],
                    ['*.woff2, *.woff, *.ttf', 'S3', '1 year'],
                    ['*.png, *.jpg, *.svg, *.ico, *.webp', 'S3', 'as needed'],
                    ['* (default)', 'Lambda / API Gateway', 'no cache (or use hadars cache config)'],
                ].map(([path, origin, ttl]) => (
                    <div key={path} className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                        <code className="text-primary text-xs">{path}</code>
                        <span className="text-muted-foreground">{origin}</span>
                        <span className="text-muted-foreground">{ttl}</span>
                    </div>
                ))}
            </div>

            <h3 className="text-lg font-semibold mb-3 mt-6 text-gradient-soft">3 — CORS for fonts</h3>
            <p className="text-muted-foreground mb-4">
                If your app loads fonts from the S3/CloudFront origin, browsers will send a CORS preflight.
                Add a CORS response policy to your S3 bucket and forward the{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Origin</code> header in the CloudFront behaviour for font extensions:
            </p>
            <Code lang="bash">{`
# S3 bucket CORS configuration (aws s3api put-bucket-cors)
{
  "CORSRules": [{
    "AllowedOrigins": ["https://your-domain.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }]
}
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Environment variables</h2>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">process.env</code> is available in all server-side code (<code className="text-sm bg-muted px-1.5 py-0.5 rounded">getInitProps</code>,{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">fetch</code>, <code className="text-sm bg-muted px-1.5 py-0.5 rounded">cache</code>, etc.) and resolved at runtime per request.
            </p>
            <p className="text-muted-foreground mb-4">
                Client-side code is an exception: <code className="text-sm bg-muted px-1.5 py-0.5 rounded">process.env.*</code> references are substituted{' '}
                <strong className="text-foreground">at build time</strong> by rspack's DefinePlugin. They will not reflect env vars
                set after the build. Use the <code className="text-sm bg-muted px-1.5 py-0.5 rounded">define</code> option for values known at build time,
                or return runtime values from <code className="text-sm bg-muted px-1.5 py-0.5 rounded">getInitProps</code> to expose them to the client.
            </p>
            <Code lang="typescript">{`
// hadars.config.ts — expose a build-time constant
const config: HadarsOptions = {
    entry: 'src/App.tsx',
    define: {
        '__API_URL__': JSON.stringify(process.env.API_URL),
    },
};

// In your component (replaced at build time, not runtime)
declare const __API_URL__: string;
const apiUrl = __API_URL__;

// For runtime env vars (e.g. Lambda env vars set after build)
export const getInitProps = async () => ({
    apiUrl: process.env.API_URL, // resolved at request time on the server
});
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">SSR cache</h2>
            <p className="text-muted-foreground mb-4">
                Cache SSR responses in-process with a TTL. Useful for pages with data that changes
                infrequently — skips the render entirely and serves the cached HTML string.
            </p>
            <Code lang="typescript">{`
const config: HadarsOptions = {
    entry: 'src/App.tsx',

    // Cache every page by pathname for 60 seconds.
    // Skip caching for authenticated users (cookie present).
    cache: (req) => req.cookies.session
        ? null
        : { key: req.pathname, ttl: 60_000 },
};
            `}</Code>
        </section>

        <footer className="mt-16 pt-8 text-center text-sm text-muted-foreground" style={{ borderTop: "1px solid oklch(0.68 0.28 285 / 0.15)" }}><p>hadars — MIT licence</p></footer>
    </>
);

export default Deployment;
