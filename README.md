# hadars

A minimal server-side rendering framework for React built on [rspack](https://rspack.dev). Runs on Bun, Node.js, and Deno.

**[hadars.xyz](https://hadars.xyz)** — docs & website

## Why hadars?

hadars is an alternative to Next.js for apps that just need SSR.

**Getting out is painful.** Next.js has its own router, image component, font loader, `<Link>`, and middleware API. These aren't just conveniences - they're load-bearing parts of your app. By the time you want to leave, you're not swapping a dependency, you're doing a rewrite.

**Server Components solved a problem I don't have.** The mental model is interesting, but the split between server-only and client-only trees, plus the serialisation boundary between them, adds real complexity for most apps. `getInitProps` + `useServerData` gets you server-rendered HTML with client hydration without any of that.

**A smaller attack surface is better.** Any framework that intercepts every request adds risk. Less code handling that path is a reasonable starting point - whether that translates to meaningful security differences is something only time and scrutiny will tell.

**Less overhead.** hadars skips RSC infrastructure, a built-in router, and edge runtime polyfills. It uses its own SSR renderer ([slim-react](#slim-react)) instead of react-dom/server. Whether that matters for your use case depends on your load, but the baseline is lighter.

Bring your own router (or none), keep your components as plain React, and get SSR, HMR, and a production build from a single config file.

## Benchmarks

<!-- BENCHMARK_START -->
> Last run: 2026-04-17 · 120s · 100 connections · Bun runtime
> hadars is **9.5x faster** in requests/sec

**Throughput** (autocannon, 120s)

| Metric | hadars | Next.js |
|---|---:|---:|
| Requests/sec | **218** | 23 |
| Latency median | **446 ms** | 2421 ms |
| Latency p99 | **838 ms** | 3244 ms |
| Throughput | **62.07** MB/s | 12.6 MB/s |
| Peak RSS | 1032.7 MB | **514.0 MB** |
| Avg RSS | 842.2 MB | **462.8 MB** |
| Build time | 1.1 s | 5.3 s |

**Page load** (Playwright · Chromium headless · median)

| Metric | hadars | Next.js |
|---|---:|---:|
| TTFB | **15 ms** | 33 ms |
| FCP | **76 ms** | 112 ms |
| DOMContentLoaded | **31 ms** | 101 ms |
| Load | **96 ms** | 139 ms |
| Peak RSS | 508.0 MB | **299.5 MB** |
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

# Pre-render every page to static HTML files (output goes to out/ by default)
hadars export static [outDir]

# Write the inferred GraphQL schema to a SDL file (for graphql-codegen / gql.tada)
hadars export schema [schema.graphql]

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
    const user = useServerData(() => db.getUser(userId));
    if (!user) return null; // undefined while pending on the first SSR pass
    return <p>{user.name}</p>;
};
```

The cache key is derived automatically from the call-site's position in the component tree via `useId()` — no manual key is needed.

- **Server (SSR)** - calls `fn()`, awaits the result across render iterations, returns `undefined` until resolved
- **Client (hydration)** - reads the pre-resolved value from the hydration cache serialised by the server; `fn()` is never called in the browser
- **Client (navigation)** - when a component mounts during client-side navigation and its data is not in the cache, hadars fires a single `GET <current-url>` with `Accept: application/json`; all `useServerData` calls within the same render are batched into one request and suspended via React Suspense until the server returns the JSON data map

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `cache` | `boolean` | `true` | When `false`, the cached value is evicted when the component unmounts so the next mount fetches fresh data from the server. Safe with React Strict Mode. |

```tsx
// Uptime changes every request — evict on unmount so re-mounting always fetches fresh
const uptime = useServerData(() => process.uptime(), { cache: false });
```

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
| `paths` | `function` | - | Returns URL list to pre-render with `hadars export static`; receives `HadarsStaticContext` |
| `sources` | `array` | - | Gatsby-compatible source plugins; hadars infers a GraphQL schema from their nodes |
| `graphql` | `function` | - | Custom GraphQL executor passed to `paths()` and `getInitProps()` as `ctx.graphql` |
| `onError` | `function` | - | Called on every SSR render error; use to forward to Sentry, Datadog, etc. |

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

### swcPlugins example

SWC plugins let you apply compiler transforms (Relay, emotion, styled-components, etc.) to every file in both the client and SSR bundles.

```ts
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    swcPlugins: [
        ['@swc/plugin-relay', { rootDir: process.cwd(), artifactDirectory: 'src/__generated__' }],
    ],
};

export default config;
```

**Plugin version compatibility** — SWC plugins are compiled against a specific version of `swc_core` and will silently fail or crash if the version doesn't match rspack's internal SWC. For `@rspack/core@1.6.8` the compatible plugins are:

| Plugin | Version |
|---|---|
| `@swc/plugin-relay` | `10.0.0` |
| `@swc/plugin-emotion` | `12.0.0` |
| `@swc/plugin-styled-components` | `10.0.0` |
| `@swc/plugin-styled-jsx` | `11.0.0` |
| `@swc/plugin-jest` | `10.0.0` |
| `@swc/plugin-formatjs` | `7.0.0` |
| `@swc/plugin-transform-imports` | `10.0.0` |
| `@swc/plugin-loadable-components` | `9.0.0` |
| `@swc/plugin-prefresh` | `10.0.0` |
| `swc-plugin-css-modules` | `6.0.0` |
| `swc-plugin-pre-paths` | `6.0.0` |
| `swc-plugin-transform-remove-imports` | `7.0.0` |
| `@lingui/swc-plugin` | `5.9.0` |

Install the exact version listed — do **not** use `latest` or a semver range. The full compatibility matrix for other rspack versions is at [plugins.swc.rs](https://plugins.swc.rs).

> The `@swc/core` package in hadars's `optionalDependencies` is used only by the hadars loader for its own AST transforms. It is a separate concern from the SWC version bundled inside rspack that runs your plugins.

### Error monitoring example

```ts
import * as Sentry from '@sentry/node';
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    onError: (err, req) => Sentry.captureException(err, {
        extra: { url: req.url, method: req.method },
    }),
};

export default config;
```

`onError` is called on every SSR render error in `dev()`, `run()`, Lambda, and Cloudflare adapters. The handler may be async — hadars fires it without awaiting so it never delays the error response to the browser.

## Static Export

> **Experimental.** Static export and Gatsby-compatible source plugins are new features. The API — including config shape, context object, and schema inference behaviour — may change in future releases without a major version bump.

Pre-render every page to a plain HTML file and deploy to any static host — no server required.

```bash
# Output goes to out/ by default
hadars export static

# Custom output directory
hadars export static dist
```

Add a `paths` function to `hadars.config.ts` that returns the list of URLs to pre-render:

```ts
// hadars.config.ts
import type { HadarsOptions } from 'hadars';

export default {
    entry: './src/App.tsx',
    paths: () => ['/', '/about', '/contact'],
} satisfies HadarsOptions;
```

Each URL is written as `<outDir>/<path>/index.html` plus an `index.json` sidecar so `useServerData` keeps working on client-side navigation without a live server. Static assets are copied from `.hadars/static/`.

### Data in static pages

`getInitProps` receives a `HadarsStaticContext` as its second argument during static export. Use it to fetch data from a database, API, or GraphQL layer:

```ts
import type { HadarsApp, HadarsRequest, HadarsStaticContext } from 'hadars';

export const getInitProps = async (
    req: HadarsRequest,
    ctx?: HadarsStaticContext,
): Promise<Props> => {
    if (!ctx) return { posts: [] };
    const { data } = await ctx.graphql('{ allPost { id title } }');
    return { posts: data?.allPost ?? [] };
};
```

## Source Plugins

hadars source plugins follow the same API as Gatsby's `sourceNodes` — so most existing Gatsby CMS source plugins work out of the box. Each plugin creates typed nodes in an in-memory store; hadars infers a GraphQL schema automatically and exposes it to `paths()` and `getInitProps()`.

During `hadars dev`, a GraphiQL IDE is available at `/__hadars/graphql` so you can explore the inferred schema while you build.

### Install graphql

Schema inference requires `graphql` to be installed in your project:

```bash
npm install graphql
```

### Config

```ts
// hadars.config.ts
import type { HadarsOptions, HadarsStaticContext } from 'hadars';

export default {
    entry: './src/App.tsx',

    sources: [
        {
            resolve: 'gatsby-source-contentful',
            options: {
                spaceId: process.env.CONTENTFUL_SPACE_ID,
                accessToken: process.env.CONTENTFUL_ACCESS_TOKEN,
            },
        },
    ],

    paths: async ({ graphql }: HadarsStaticContext) => {
        const { data } = await graphql(`{ allContentfulBlogPost { slug } }`);
        const slugs = data?.allContentfulBlogPost?.map((p: any) => p.slug) ?? [];
        return ['/', ...slugs.map((s: string) => `/post/${s}`)];
    },
} satisfies HadarsOptions;
```

### Local source plugin

Pass a pre-imported module instead of a package name to use a local plugin without publishing it to npm:

```ts
// src/posts-source.ts
export async function sourceNodes(
    { actions, createNodeId, createContentDigest }: any,
    options: { dataDir: string } = {},
) {
    const { createNode } = actions;
    const posts = await fetchPostsFromMyApi();
    for (const post of posts) {
        createNode({
            ...post,
            id: createNodeId(post.slug),
            internal: { type: 'BlogPost', contentDigest: createContentDigest(post) },
        });
    }
}
```

```ts
// hadars.config.ts
import * as postsSource from './src/posts-source';

export default {
    entry: './src/App.tsx',
    sources: [{ resolve: postsSource }],
    paths: async ({ graphql }) => {
        const { data } = await graphql('{ allBlogPost { slug } }');
        return ['/', ...(data?.allBlogPost ?? []).map((p: any) => `/post/${p.slug}`)];
    },
} satisfies HadarsOptions;
```

### Inferred GraphQL schema

For each node type (e.g. `BlogPost`) you get two root queries:

| Query | Returns |
|---|---|
| `allBlogPost` | Every BlogPost node |
| `blogPost(id, slug, title, …)` | First node matching all supplied args |

All scalar fields are automatically added as optional lookup arguments, so you can do `blogPost(slug: "hello")` without knowing the hashed node id.

### useGraphQL hook

Query your GraphQL layer directly inside any component — no need to pass data down through `getInitProps`. The hook integrates with `useServerData` so queries are executed on the server during static export and hydrated on the client.

```tsx
import { useGraphQL } from 'hadars';
import { GetAllPostsDocument } from './gql/graphql';

const PostList = () => {
    const result = useGraphQL(GetAllPostsDocument);
    const posts = result?.data?.allBlogPost ?? [];
    return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
};
```

Pass variables as a second argument:

```tsx
const PostPage = ({ slug }: { slug: string }) => {
    const result = useGraphQL(GetPostDocument, { slug });
    const post = result?.data?.blogPost;
    if (!post) return null;
    return <h1>{post.title}</h1>;
};
```

- `result` is `undefined` on the first SSR pass (data not yet resolved) — render `null` or a skeleton
- When a typed `DocumentNode` from graphql-codegen is passed, the return type is fully inferred — `result.data` has the exact shape of your query
- GraphQL errors throw during static export so the page is marked as failed rather than silently serving incomplete data
- Requires `graphql` and a `sources` or `graphql` executor configured in `hadars.config.ts`

### Schema export & type generation

Run `hadars export schema` to write the inferred schema to a SDL file, then feed it to **graphql-codegen** to generate TypeScript types for your queries:

```bash
# 1. Generate schema.graphql from your sources
hadars export schema

# 2. Install codegen (one-time)
npm install -D @graphql-codegen/cli @graphql-codegen/typescript @graphql-codegen/typescript-operations

# 3. Generate types
npx graphql-codegen --schema schema.graphql --documents "src/**/*.tsx" --out src/gql/
```

Or use a `codegen.ts` config file:

```ts
// codegen.ts
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
    schema: 'schema.graphql',
    documents: ['src/**/*.tsx'],
    generates: {
        'src/gql/': {
            preset: 'client',
        },
    },
};

export default config;
```

`hadars export schema` also works with a custom `graphql` executor — it runs an introspection query against it and converts the result to SDL.

### GraphQL fragments

graphql-codegen's `client` preset generates fragment masking helpers (`FragmentType`, `useFragment`, `makeFragmentData`) that let components co-locate their exact data requirements. No hadars changes are needed — just define your fragment with `graphql()` and accept a masked prop:

```tsx
// src/PostCard.tsx
import { graphql, useFragment, type FragmentType } from './gql';

export const PostCardFragment = graphql(`
    fragment PostCard on BlogPost {
        slug
        title
        date
    }
`);

interface Props {
    post: FragmentType<typeof PostCardFragment>;
}

const PostCard = ({ post: postRef }: Props) => {
    const post = useFragment(PostCardFragment, postRef);
    return (
        <article>
            <h2>{post.title}</h2>
            <time>{post.date}</time>
        </article>
    );
};
```

The parent component spreads the raw node into the masked prop — TypeScript ensures it satisfies the fragment shape:

```tsx
const PostList = () => {
    const result = useGraphQL(GetAllPostsDocument);
    return (
        <>
            {result?.data?.allBlogPost.map(post => (
                <PostCard key={post.slug} post={post} />
            ))}
        </>
    );
};
```

### Custom GraphQL executor

Skip `sources` and provide a `graphql` executor directly for full control over resolvers:

```ts
import { graphql, buildSchema } from 'graphql';
import type { HadarsOptions } from 'hadars';

const schema = buildSchema(`
    type Post { id: ID! title: String slug: String }
    type Query { allPost: [Post!]! }
`);

export default {
    entry: './src/App.tsx',
    graphql: (query, variables) =>
        graphql({ schema, rootValue: { allPost: fetchPostsFromDb }, source: query, variableValues: variables }),
    paths: async ({ graphql }) => {
        const { data } = await graphql('{ allPost { slug } }');
        return ['/', ...(data?.allPost ?? []).map((p: any) => `/post/${p.slug}`)];
    },
} satisfies HadarsOptions;
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
