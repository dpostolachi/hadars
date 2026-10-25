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

For custom server integrations, `resolvePinnedBuilds(options, dev?)` from `hadars/composition/build` performs the same validation and returns the same descriptors. Pinned filesystem loading is integrated with `dev`/`run`. The edge export embeds public client metadata and stages client assets as described below; static site export does not automatically assemble pinned files.

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

## Runtime boundaries

Use `hadars/composition/runtime` for client loading, registration, shared packages
and `ModuleHead` in browser or edge shells. It has no Node imports, including in
CommonJS builds. No resolver alias is needed. The existing `hadars/composition`
entry remains compatible with Node shells; it also exports the filesystem loader.

`loadServerModule` (directory or descriptor), `resolvePinnedBuilds`, and reading
pinned `buildsDir` are filesystem-bound. Import these from
`hadars/composition/build` in Node tooling. The edge handler accepts bundled data;
it must never resolve a pinned directory at request time. Server bundle static
registration is a future extension point for filesystem-free module SSR.

## Module build hooks

`buildModule` and `startModuleDevServer` accept `resolve: { alias, tsConfig }`.
Aliases use the bundler's exact/prefix matching; `tsConfig` is a path relative to
`cwd` and supports tsconfig `paths` (including extended configs).
They also accept the app's `swcPlugins` list: WASM plugin package/path strings,
`[path, options]` tuples, or `{ path, options }`. Plugins run before transforms
on both targets. Match the WASM plugin version to the installed bundler and pass
its required options (for example `rootDir` for a query transform). Function
transforms require a precompiled entry: point `composition.exposes` at the
JavaScript produced by your transform, keeping shared imports external.

```ts
await buildModule({
    composition: { role: 'module', name: 'example', exposes: { page: 'src/Page.tsx' } },
    cwd: process.cwd(), outDir: '/tmp/example-build',
    resolve: { alias: { '@components': '/project/src/components' }, tsConfig: 'tsconfig.json' },
    swcPlugins: [['@swc/plugin-relay', { language: 'typescript', rootDir: './src' }]],
});
```

## Immutable artifacts and lock tooling

The Node-only `hadars/composition/build` entry exports:

- `createModuleBuild({ ...buildOptions, result, buildsDir, requires? })`: consumes
  `buildModule` output, includes all files below client/server (chunks, assets and
  target manifests), and copies immutable bytes to `<buildsDir>/<buildId>`.
- `createShellBuild({ sourceDir, buildsDir, name, targets, provides })`: snapshots
  a directory containing the compiled shell, including actual server and client
  files. Targets are relative to this directory; `provides` lists exact shared
  specifiers. A shell with no files is rejected. Keep sourceDir separate from
  buildsDir and exclude temporary inputs before calling.
- `createBuild(options)`: the same artifact workflow for any supported kind.
- `computeBuildId(manifest)`, `createIntegrityMap(manifests)`,
  `assembleLockfile({ shell, modules, libraries })`, and
  `verifyLockfile(pinnedOptions, dev?)`. Verification uses the runtime resolver
  and checks every declared byte, not just lock checksums.

```ts
const result = await buildModule(options);
const module = createModuleBuild({ ...options, result, buildsDir });
const shell = createShellBuild({ sourceDir: compiledShellDir, buildsDir,
    name: 'shell', provides: ['shared-context'],
    targets: { client: { js: ['client/main.js'], css: [] },
               server: { js: ['server/main.cjs'], css: [] } } });
const lock = assembleLockfile({ shell: shell.manifest, modules: [module.manifest] });
// Write lock as JSON and createIntegrityMap([shell.manifest, module.manifest])
// beside buildsDir as integrity.json, then await verifyLockfile(pinnedOptions).
```

Existing artifact directories are never rewritten: identical bytes are reused,
while changed or extra bytes are rejected. Copying snapshots the source bytes
before deriving identity. Keep published directories immutable thereafter.

The v1 contract remains unchanged. SHA-256 over JSON with the following property
order, truncated to the first 16 hex characters, yields the build ID: optional
nonempty sorted `types`; optional `typeApi` (declarationsSha256 then sorted
namespace/export maps); `kind`, `name`, `runtimeContract`, `flavour`, `targets`
(client then server, each js then css, retaining array order), sorted `exposes`,
`shared`, `provides`, sorted-key `requires`, and path-sorted `files` (each path,
size, sha256). `buildId` is excluded. Snapshot identity hashes `{ shell, modules,
libraries }` with name-sorted maps and prefixes the truncated hash with `snap_`.
Manifest and snapshot checksums hash recursively key-sorted canonical JSON.

The CLI exposes `hadars composition build spec.json manifest.json`,
`hadars composition lock spec.json hadars.lock`, and
`hadars composition verify hadars.lock .hadars/builds`. Build specs use
`CreateBuildOptions`; lock specs contain a shell manifest filename and optional
module/library manifest filename arrays. Paths resolve from the working directory.
The build command writes the manifest separately from the immutable artifact;
lock verification does not require an app configuration.

## Pinned client export

The edge export automatically resolves the production lock, validates every
pinned file, rejects undeclared files, embeds public module client descriptors,
and copies declared module client files into the static output at
`<publicBase>/<buildId>/<path>`. For an absolute asset URL the URL pathname is
used beneath the static output; publish those files at that origin/path.
Generated target manifests must be included in the immutable artifact's file
list, as the public builders do. Missing or changed bytes fail the export before
asset copying starts. Client entry scripts and styles receive derived SRI even
when no separate integrity map exists.

Use `req.pinnedClients?.greeter` in `getInitProps` for a client-only module. This
property is available in dev/run and in the bundled edge handler, and contains no
server descriptor or local path. Return that descriptor as client props and use
`ModuleHead` and `loadClientModule` from `hadars/composition/runtime`. Custom
export integrations can call `assemblePinnedExport(pinnedOptions, staticDir)`
and pass its result as the handler's bundled `pinnedClients` field.

Pinned server bundles are validated but never copied into static output or loaded
by the edge handler. A future exporter can statically import these bundles and
register their namespaces after publishing shared packages. That extension must
retain shared externals and must not introduce request-time filesystem access.

## Shared package version contracts

For version enforcement, modules declare `composition.requires: { pkg: range }`
(or pass `requires` when creating an immutable module build), and shells use
`createShellBuild({ ..., provides: { pkg: version } })`. Versions must be valid
semantic versions and ranges follow npm semver rules, including prerelease rules.
Every required specifier must have a provided version, including React/JSX
specifiers when they are required explicitly. Custom shared APIs can declare
semantic versions the same way.

```ts
const options = {
    composition: { role: 'module' as const, name: 'example',
        exposes: { page: 'src/Page.tsx' }, shared: ['shared-api'],
        requires: { 'shared-api': '^2.0.0' } },
    cwd: process.cwd(), outDir: '/tmp/example-build',
    inferRequires: ['react', 'shared-api'],
};
```

`inferRequires: true` fills exact requirements for all default and explicit shared
specifiers from packages resolved in `cwd`. An array selects which packages to
infer; explicit ranges take precedence. For aliases and local shared APIs, use
explicit ranges. `buildModule` and the dev server write `composition.json` next
to the target directories; dev overrides validate these requirements against the
pinned shell. Older overrides without that file retain the pin's requirements.

Versioned `provides` changes the manifest shape, so it uses **manifest runtime
contract `2`**. Contract 2 identities use the same property order as v1, with a
sorted-key `provides` map replacing the sorted array. Builders select contract 2
for versioned provides or nonempty requires, or when `runtimeContract: '2'` is
explicit. Unversioned builders continue to produce contract 1. The v1 lock
container and snapshot rules are unchanged; the resolver accepts both manifest
contracts. Existing contract 1 identities remain byte-for-byte unchanged. A
contract 1 shell has no version information and cannot satisfy a nonempty version
requirement. Both contracts retain the same JavaScript sharing ABI.

Lock assembly, production resolution, dev resolution (including overrides) and
edge export reject incompatible versions with the module name, package, required
range and provided version. A dev override's serverDir and clientUrl must come
from the same build.
