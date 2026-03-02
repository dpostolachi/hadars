# hadars

A minimal server-side rendering framework for React built on [rspack](https://rspack.dev). Runs on Bun, Node.js, and Deno.

## Install

```bash
npm install hadars
```

## Quick start

**hadars.config.ts**
```ts
import os from 'os';
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    port: 3000,
    workers: os.cpus().length, // multi-core production server (Node.js)
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

After installing hadars the `hadars` binary is available. It works on Node.js, Bun, and Deno — the runtime is auto-detected:

```bash
# Development server with React Fast Refresh HMR
hadars dev

# Production build (client + SSR bundles compiled in parallel)
hadars build

# Serve the production build
hadars run         # multi-core when workers > 1
```

## Features

- **React Fast Refresh** — full HMR via rspack-dev-server, module-level patches
- **True SSR** — components render on the server with your data, then hydrate on the client
- **Shell streaming** — HTML shell is flushed immediately so browsers can start loading assets before the body arrives
- **Code splitting** — `loadModule('./Comp')` splits on the browser, bundles statically on the server
- **Head management** — `HadarsHead` controls `<title>`, `<meta>`, `<link>` on server and client
- **Cross-runtime** — Bun, Node.js, Deno; uses the standard Fetch API throughout
- **Multi-core** — `workers: os.cpus().length` forks a process per CPU core via `node:cluster`
- **TypeScript-first** — full types for props, lifecycle hooks, config, and the request object

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

- **`key`** — string or string array; must be stable and unique within the page
- **Server** — calls `fn()`, awaits the result across render iterations, returns `undefined` until resolved
- **Client** — reads the pre-resolved value from the hydration cache serialised by the server; `fn()` is never called in the browser
- **Suspense libraries** — also works when `fn()` throws a thenable (e.g. Relay `useLazyLoadQuery` with `suspense: true`); the thrown promise is awaited and the next render re-calls `fn()` synchronously

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
| `entry` | `string` | — | Path to your page component **(required)** |
| `port` | `number` | `9090` | HTTP port |
| `hmrPort` | `number` | `port + 1` | rspack HMR dev server port |
| `baseURL` | `string` | `""` | Public base path, e.g. `"/app"` |
| `workers` | `number` | `1` | Worker processes in `run()` mode (Node.js only) |
| `proxy` | `Record / fn` | — | Path-prefix proxy rules or a custom async function |
| `proxyCORS` | `boolean` | — | Inject CORS headers on proxied responses |
| `define` | `Record` | — | Compile-time constants for rspack's DefinePlugin |
| `swcPlugins` | `array` | — | Extra SWC plugins (e.g. Relay compiler) |
| `fetch` | `function` | — | Custom fetch handler; return a `Response` to short-circuit SSR |
| `websocket` | `object` | — | WebSocket handler (Bun only) |
| `wsPath` | `string` | `"/ws"` | Path that triggers WebSocket upgrade |
| `optimization` | `object` | — | Override rspack `optimization` for production client builds (merged on top of defaults) |

## License

MIT
