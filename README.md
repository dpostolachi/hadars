# hadars

A minimal server-side rendering framework for React built on [rspack](https://rspack.dev). Runs on Bun, Node.js, and Deno.

## Why hadars?

hadars is an alternative to Next.js for apps that just need SSR.

**Getting out is painful.** Next.js has its own router, image component, font loader, `<Link>`, and middleware API. These aren't just conveniences - they're load-bearing parts of your app. By the time you want to leave, you're not swapping a dependency, you're doing a rewrite.

**Server Components solved a problem I don't have.** The mental model is interesting, but the split between server-only and client-only trees, plus the serialisation boundary between them, adds real complexity for most apps. `getInitProps` + `useServerData` gets you server-rendered HTML with client hydration without any of that.

**A smaller attack surface is better.** Any framework that intercepts every request adds risk. Less code handling that path is a reasonable starting point - whether that translates to meaningful security differences is something only time and scrutiny will tell.

**Less overhead.** hadars skips RSC infrastructure, a built-in router, and edge runtime polyfills. It uses its own SSR renderer ([slim-react](#slim-react)) instead of react-dom/server. Whether that matters for your use case depends on your load, but the baseline is lighter.

Bring your own router (or none), keep your components as plain React, and get SSR, HMR, and a production build from a single config file.

## Benchmarks

<!-- BENCHMARK_START -->
> Last run: 2026-03-21 · 60s · 100 connections · Bun runtime
> hadars is **8.7x faster** in requests/sec

**Throughput** (autocannon, 60s)

| Metric | hadars | Next.js |
|---|---:|---:|
| Requests/sec | **148** | 17 |
| Latency median | **647 ms** | 2712 ms |
| Latency p99 | **969 ms** | 6544 ms |
| Throughput | **42.23** MB/s | 9.29 MB/s |
| Peak RSS | 1062.8 MB | **472.3 MB** |
| Avg RSS | 799.7 MB | **404.7 MB** |
| Build time | 0.7 s | 6.0 s |

**Page load** (Playwright · Chromium headless · median)

| Metric | hadars | Next.js |
|---|---:|---:|
| TTFB | **20 ms** | 43 ms |
| FCP | **100 ms** | 136 ms |
| DOMContentLoaded | **41 ms** | 127 ms |
| Load | **127 ms** | 174 ms |
| Peak RSS | 444.7 MB | **284.9 MB** |
<!-- BENCHMARK_END -->

## Quick start

Scaffold a new project in seconds:

```bash
npx hadars new my-app
cd my-app
npm install
npm run dev
```

Or install manually:

```bash
npm install hadars
```

## Example

**hadars.config.ts**
```ts
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    port: 3000,
};

export default config;
```

**src/App.tsx**
```tsx
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
```

## CLI

```bash
# Scaffold a new project
hadars new <project-name>

# Development server with React Fast Refresh HMR
hadars dev

# Production build (client + SSR bundles compiled in parallel)
hadars build

# Serve the production build
hadars run

# Bundle the app into a single self-contained Lambda .mjs file
hadars export lambda [output.mjs]

# Bundle the app into a single self-contained Cloudflare Worker .mjs file
hadars export cloudflare [output.mjs]
```

## Features

- **React Fast Refresh** - full HMR via rspack-dev-server, module-level patches
- **True SSR** - components render on the server with your data, then hydrate on the client
- **Shell streaming** - HTML shell is flushed immediately so browsers can start loading assets before the body arrives
- **Code splitting** - `loadModule('./Comp')` splits on the browser, bundles statically on the server
- **Head management** - `HadarsHead` controls `<title>`, `<meta>`, `<link>` on server and client
- **Cross-runtime** - Bun, Node.js, Deno; uses the standard Fetch API throughout
- **Multi-core** - `workers: os.cpus().length` forks a process per CPU core via `node:cluster`
- **TypeScript-first** - full types for props, lifecycle hooks, config, and the request object

## useServerData

Fetch async data inside a component during SSR. The framework's render loop awaits the promise and re-renders until all values are resolved, then serialises them into the page for zero-cost client hydration.

```tsx
import { useServerData } from 'hadars';

const UserCard = ({ userId }: { userId: string }) => {
    const user = useServerData(['user', userId], () => db.getUser(userId));
    if (!user) return null; // undefined while pending on the first SSR pass
    return <p>{user.name}</p>;
};
```

- **`key`** - string or string array; must be stable and unique within the page
- **Server (SSR)** - calls `fn()`, awaits the result across render iterations, returns `undefined` until resolved
- **Client (hydration)** - reads the pre-resolved value from the hydration cache serialised by the server; `fn()` is never called in the browser
- **Client (navigation)** - when a component mounts during client-side navigation and its key is not in the cache, hadars fires a single `GET <current-url>` with `Accept: application/json`; all `useServerData` calls within the same render are batched into one request and suspended via React Suspense until the server returns the JSON data map

## Data lifecycle hooks

| Hook | Runs on | Purpose |
|---|---|---|
| `getInitProps` | server | Fetch server-side data from the `HadarsRequest` |
| `getFinalProps` | server | Strip server-only fields before props are serialised to the client |
| `getClientProps` | client | Enrich props with browser-only data (localStorage, device APIs) |

## HadarsOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `entry` | `string` | - | Path to your page component **(required)** |
| `port` | `number` | `9090` | HTTP port |
| `hmrPort` | `number` | `port + 1` | rspack HMR dev server port |
| `baseURL` | `string` | `""` | Public base path, e.g. `"/app"` |
| `workers` | `number` | `1` | Worker processes / threads in `run()` mode |
| `proxy` | `Record / fn` | - | Path-prefix proxy rules or a custom async function |
| `proxyCORS` | `boolean` | - | Inject CORS headers on proxied responses |
| `define` | `Record` | - | Compile-time constants for rspack's DefinePlugin |
| `swcPlugins` | `array` | - | Extra SWC plugins (e.g. Relay compiler) |

> **Environment variables in client bundles:** `process.env.*` references in client-side code are replaced at build time by rspack's DefinePlugin. They are **not** read at runtime in the browser. Use the `define` option to expose specific values, or keep env var access inside `getInitProps` / `fetch` (server-only code) so they are resolved at request time.
| `moduleRules` | `array` | - | Extra rspack module rules appended to the built-in set (client + SSR) |
| `fetch` | `function` | - | Custom fetch handler; return a `Response` to short-circuit SSR |
| `websocket` | `object` | - | WebSocket handler (Bun only) |
| `wsPath` | `string` | `"/ws"` | Path that triggers WebSocket upgrade |
| `htmlTemplate` | `string` | - | Path to a custom HTML template with `HADARS_HEAD` / `HADARS_BODY` markers |
| `optimization` | `object` | - | Override rspack `optimization` for production client builds |
| `cache` | `function` | - | SSR response cache for `run()` mode; return `{ key, ttl? }` to cache a request |

### moduleRules example

Add support for any loader not included by default:

```ts
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    moduleRules: [
        {
            test: /\.mdx?$/,
            use: [{ loader: '@mdx-js/loader' }],
        },
    ],
};

export default config;
```

### SSR cache example

```ts
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    // Cache every page by pathname for 60 seconds, skip authenticated requests
    cache: (req) => req.cookies.session ? null : { key: req.pathname, ttl: 60_000 },
};

export default config;
```

## AWS Lambda

hadars apps can be deployed to AWS Lambda backed by API Gateway (HTTP API v2 or REST API v1).

### File-based deployment

Run `hadars build`, then create a Lambda entry file that imports `createLambdaHandler` from `hadars/lambda`:

```ts
// lambda-entry.ts
import { createLambdaHandler } from 'hadars/lambda';
import config from './hadars.config';

export const handler = createLambdaHandler(config);
```

Deploy the entire project directory (including the `.hadars/` output folder) as your Lambda package. Static assets (JS, CSS, fonts) under `.hadars/static/` are served directly by the Lambda handler — for production, front the function with CloudFront and route static paths to an S3 origin instead.

### Single-file bundle

`hadars export lambda` produces a completely self-contained `.mjs` file that requires no `.hadars/` directory on disk. The SSR module and HTML template are inlined at build time. Static assets must be served separately (S3 + CloudFront).

```bash
# Outputs lambda.mjs in the current directory
hadars export lambda

# Custom output path
hadars export lambda dist/lambda.mjs
```

The command:
1. Runs `hadars build`
2. Generates a temporary entry shim with static imports of the SSR module and `out.html`
3. Bundles everything into a single ESM `.mjs` with esbuild (`.html` files loaded as text, Node built-ins kept external)
4. Prints deploy instructions

**Deploy steps:**
1. Upload the output `.mjs` as your Lambda function code
2. Set the handler to `index.handler`
3. Upload `.hadars/static/` assets to S3 and serve via CloudFront

### `createLambdaHandler` API

```ts
import { createLambdaHandler, type LambdaBundled } from 'hadars/lambda';

// File-based (reads .hadars/ at runtime)
export const handler = createLambdaHandler(config);

// Bundled (zero I/O — for use with `hadars export lambda` output)
import * as ssrModule from './.hadars/index.ssr.js';
import outHtml from './.hadars/static/out.html';
export const handler = createLambdaHandler(config, { ssrModule, outHtml });
```

| Parameter | Type | Description |
|---|---|---|
| `options` | `HadarsOptions` | Same config object used for `dev`/`run` |
| `bundled` | `LambdaBundled` *(optional)* | Pre-loaded SSR module + HTML; eliminates all runtime file I/O |

The handler accepts both **API Gateway HTTP API (v2)** and **REST API (v1)** event formats. Binary responses (images, fonts, pre-compressed assets) are automatically base64-encoded.

### Environment variables on Lambda

`process.env` is available in all server-side code (`getInitProps`, `fetch`, `cache`, etc.) and is resolved at runtime per invocation — Lambda injects env vars into the process before your handler runs.

Client-side code (anything that runs in the browser) is an exception: `process.env.*` references are substituted **at build time** by rspack. They will not reflect Lambda env vars set after the build. Expose runtime values to the client by returning them from `getInitProps` instead, or use the `define` option for values that are known at build time.

### `useServerData` on Lambda

Client-side navigation sends a `GET <url>` request with `Accept: application/json` to refetch server data. The Lambda handler returns a JSON `{ serverData }` map for these requests — the same as the regular server does — so `useServerData` works identically in both deployment modes.

## Cloudflare Workers

hadars apps can be deployed to Cloudflare Workers. The Worker handles SSR; static assets (JS, CSS, fonts) are served from R2 or another CDN.

### Single-file bundle

`hadars export cloudflare` produces a self-contained `.mjs` Worker script. Unlike the Lambda adapter, no event format conversion is needed — Cloudflare Workers natively use the Web `Request`/`Response` API.

```bash
# Outputs cloudflare.mjs in the current directory
hadars export cloudflare

# Custom output path
hadars export cloudflare dist/worker.mjs
```

The command:
1. Runs `hadars build`
2. Generates an entry shim with static imports of the SSR module and `out.html`
3. Bundles everything into a single ESM `.mjs` with esbuild (`platform: browser`, `target: es2022`)
4. Prints wrangler deploy instructions

### Deploy steps

1. Add a `wrangler.toml` pointing at the output file:

```toml
name = "my-app"
main = "cloudflare.mjs"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
```

2. Upload `.hadars/static/` assets to R2 and configure routing rules so static file extensions (`*.js`, `*.css`, etc.) are served from R2 and all other requests go to the Worker.

3. Deploy:

```bash
wrangler deploy
```

### `createCloudflareHandler` API

```ts
import { createCloudflareHandler, type CloudflareBundled } from 'hadars/cloudflare';
import * as ssrModule from './.hadars/index.ssr.js';
import outHtml from './.hadars/static/out.html';
import config from './hadars.config';

export default createCloudflareHandler(config, { ssrModule, outHtml });
```

| Parameter | Type | Description |
|---|---|---|
| `options` | `HadarsOptions` | Same config object used for `dev`/`run` |
| `bundled` | `CloudflareBundled` | Pre-loaded SSR module + HTML template |

The returned object is a standard Cloudflare Workers export (`{ fetch(req, env, ctx) }`).

### CPU time

hadars uses [slim-react](#slim-react) for SSR which is synchronous and typically renders a page in under 3 ms — well within Cloudflare's 10 ms free-plan CPU budget. Paid plans (Workers Paid) have no CPU time limit.

## slim-react

hadars ships its own lightweight React-compatible SSR renderer called **slim-react** (`src/slim-react/`). It replaces `react-dom/server` on the server side entirely.

For server builds, rspack aliases `react` and `react/jsx-runtime` to slim-react, so your components and any libraries they import render through it automatically without code changes.

- Renders the full component tree to an HTML string with native `async/await` — async components are awaited directly
- Implements the React Suspense protocol: thrown Promises (e.g. from `useSuspenseQuery`) are awaited and the component retried automatically
- Compatible with `hydrateRoot` — output matches what React expects on the client
- Supports `React.memo`, `React.forwardRef`, `React.lazy`, `Context.Provider`, `Context.Consumer`, and the React 19 element format

## License

MIT
