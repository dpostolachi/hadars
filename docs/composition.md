# Experimental composition

A shell provides React and shared packages; independently built modules import those instances. One process or browser page hosts one composition. The helpers are experimental, and module APIs are untyped unless the caller supplies a type to `getModule<T>()`.

## Build a module

```ts
import { buildModule } from 'hadars/composition/build';

await buildModule({
    composition: {
        role: 'module', name: 'greeter',
        exposes: { greeting: 'src/greeting.tsx' },
        shared: ['my-shared-package'],
    },
    cwd: process.cwd(),
    outDir: '/tmp/greeter-build',
});
```

The result lists `client` and `server` JavaScript and CSS entries. The output directories contain their own `manifest.json`. Each exposed file becomes a namespace, for example `getModule('greeter').greeting.Greeting`. React and its JSX runtimes are always shared. Extra `shared` packages must be published by the shell through `provideShared` before loading.

## Consume pinned builds

Configure a shell in `hadars.config.ts`:

```ts
import type { HadarsOptions } from 'hadars';

export default {
    entry: 'src/App.tsx',
    composition: {
        role: 'shell', name: 'shell',
        pinned: {
            lockFile: 'hadars.lock',
            buildsDir: '.hadars/builds',
            publicBase: '/_builds/',
        },
    },
} satisfies HadarsOptions;
```

Paths resolve from the project working directory. `publicBase` defaults to `/_builds/` and may instead be an absolute HTTP(S) asset URL, such as `https://assets.example/builds/`. Assets are addressed as `<publicBase>/<buildId>/<artifact path>`. For a local URL path, `hadars dev` and `hadars run` serve declared client files, including files under `client/` needed for chunks, images, or fonts. Server entries and declarations are excluded. For an absolute URL, upload the client assets separately and configure CORS on that origin.

The v1 lock contains `snapshotId`, `snapshotSha256`, `snapshot: { id, shell, modules, libraries }`, and `builds: { [buildId]: { sha256, manifest } }`. Snapshot references are exact content-derived build IDs. Each manifest declares `kind` (`shell`, `module`, or `library`), `name`, `buildId`, `runtimeContract`, `flavour`, `targets: { client: { js, css }, server: { js, css } }`, `exposes`, `shared`, `provides`, `requires`, and `files: [{ path, size, sha256 }]`. Paths in both targets are relative to the build directory. Optional `types` and `typeApi` metadata participate in build identity. Checksums cover canonical JSON with recursively sorted object keys; build and snapshot IDs additionally follow the v1 content identity rules.

Before serving, hadars checks snapshot and manifest identity, declared files, byte lengths, SHA-256, runtime contract, and module compatibility with the pinned shell. Production requires production builds and verifies every file at startup. Dev validates on startup and subsequent requests, reusing file hashes when size and modification/change timestamps are unchanged. Missing, modified, unsafe, or symlinked artifacts stop resolution with a build name and recovery instruction. Keep production artifacts immutable while the server runs. Lock checksums verify consistency; trust in the lock's origin must be established before starting hadars.

`HadarsRequest.pinnedBuilds` contains resolved builds keyed by name. Shell and library builds are included; they are not executed automatically. Load only the modules the page needs:

```tsx
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as jsxDev from 'react/jsx-dev-runtime';
import type { HadarsRequest } from 'hadars';
import type { PinnedBuild } from 'hadars/composition';
import {
    provideShared, loadServerModule, loadClientModule,
    registerModule, getModule, ModuleHead,
} from 'hadars/composition';

provideShared({ react: React, 'react/jsx-runtime': jsx, 'react/jsx-dev-runtime': jsxDev });

type Props = { client: PinnedBuild['client'] };

export async function getInitProps(req: HadarsRequest): Promise<Props> {
    const build = req.pinnedBuilds?.greeter;
    if (!build) throw new Error('Missing pinned greeter build');
    registerModule('greeter', await loadServerModule(build.server));
    return { client: build.client };
}

export async function getClientProps(props: Props) {
    registerModule('greeter', await loadClientModule('greeter', props.client.baseUrl, props.client));
    return props;
}

export default function App({ client }: Props) {
    const { greeting } = getModule('greeter');
    return <><ModuleHead client={client} /><greeting.Greeting /></>;
}
```

Only return `build.client` through client props; the server descriptor contains local paths. `loadServerModule` accepts either a target directory containing `manifest.json` or a resolved `{ dir, manifest }` descriptor. It evaluates the declared CommonJS server entry. Modules require one server entry and at least one browser entry. The browser loader waits for styles and scripts before hydration and deduplicates concurrent loads. It may also fetch `<baseUrl>/manifest.json` when no manifest is supplied.

For custom server integrations, `resolvePinnedBuilds(options, dev?)` from `hadars/composition/build` performs the same validation and returns the same descriptors. Pinned filesystem loading is integrated with `dev`/`run`; self-contained edge exports and static export do not automatically load pinned files.

## Integrity

By default, hadars reads `integrity.json` beside `buildsDir`. Set `integrityFile` to use another path. The map is `{ "<buildId>/<artifact path>": "sha256-<base64>" }`; mapped hashes must agree with the manifest. A missing map is allowed.

`ModuleHead` emits stylesheet links and inert script declarations in the SSR head. Script declarations have `type="application/hadars-module"` so modules cannot execute before the shell publishes shared packages. `loadClientModule` creates executable scripts after that setup. Both paths attach `integrity` and `crossorigin="anonymous"` to mapped files. Unmapped files have neither attribute unless the caller explicitly requests `crossOrigin` in the browser loader. Browser SRI applies to the declared entry scripts and stylesheets; it does not add SRI to chunks loaded internally by a bundle.

## Local module overrides

Run a local module with `startModuleDevServer` from `hadars/composition/dev`, supplying the same `composition`, `cwd`, and `outDir` options as `buildModule` (and optionally `port`). Its result has `clientUrl`, `serverDir`, `builds`, and `close()`.

Add a development override to the shell's pinned options:

```ts
overrides: {
    greeter: { serverDir: '/tmp/greeter-build/server', clientUrl: 'http://127.0.0.1:4200/' },
},
```

The shell must run `hadars dev`. The override uses the local server entry and client manifest instead of the pinned module and drops pinned SRI values. It supports Fast Refresh, reload fallback, and updated SSR. Overrides must name pinned modules and are ignored in production. The pinned set is still validated. Generated `.hadars/builds`, `types`, `integrity.json`, and `tsconfig.json`, plus configured pinned inputs, survive dev restarts.
