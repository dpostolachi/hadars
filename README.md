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

Benchmarks against an equivalent Next.js app show significantly faster server throughput (requests/second) and meaningfully better page load metrics (TTFB, FCP, DOMContentLoaded). Build times are also much lower due to rspack.

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
import { HadarsContext, HadarsHead, type HadarsApp, type HadarsRequest } from 'hadars';

interface Props { user: { name: string } }

const App: HadarsApp<Props> = ({ user, context }) => (
    <HadarsContext context={context}>
        <HadarsHead status={200}>
            <title>Hello {user.name}</title>
        </HadarsHead>
        <h1>Hello, {user.name}!</h1>
    </HadarsContext>
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
| `getAfterRenderProps` | server | Inspect the rendered HTML (e.g. extract critical CSS) |
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

## slim-react

hadars ships its own lightweight React-compatible SSR renderer called **slim-react** (`src/slim-react/`). It replaces `react-dom/server` on the server side entirely.

For server builds, rspack aliases `react` and `react/jsx-runtime` to slim-react, so your components and any libraries they import render through it automatically without code changes.

- Renders the full component tree to an HTML string with native `async/await` — async components are awaited directly
- Implements the React Suspense protocol: thrown Promises (e.g. from `useSuspenseQuery`) are awaited and the component retried automatically
- Compatible with `hydrateRoot` — output matches what React expects on the client
- Supports `React.memo`, `React.forwardRef`, `React.lazy`, `Context.Provider`, `Context.Consumer`, and the React 19 element format

## License

MIT
