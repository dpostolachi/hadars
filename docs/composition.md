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

`HadarsRequest.pinnedBuilds` contains resolved builds keyed by name. Shell and library builds are included; they are not executed automatically. Dev/run registers lazy server loaders for pinned modules before `getInitProps`. Edge exports register statically linked loaders with the same lookup API. Publish shared packages before the first lookup; only modules the page requests are evaluated:

```tsx
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as jsxDev from 'react/jsx-dev-runtime';
import type { HadarsRequest } from 'hadars';
import type { PinnedBuild } from 'hadars/composition';
import {
    provideShared, loadClientModule,
    registerModule, getModule, ModuleHead,
} from 'hadars/composition/runtime';

provideShared({ react: React, 'react/jsx-runtime': jsx, 'react/jsx-dev-runtime': jsxDev });

type Props = { client: PinnedBuild['client'] };

export async function getInitProps(req: HadarsRequest): Promise<Props> {
    const client = req.pinnedClients?.greeter;
    if (!client) throw new Error('Missing pinned greeter build');
    // The same lookup works in dev/run and in a linked edge export.
    const { greeting } = getModule('greeter');
    return { client };
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

Only return `build.client` through client props; the server descriptor contains local paths. `loadServerModule` accepts either a target directory containing `manifest.json` or a resolved `{ dir, manifest }` descriptor. It evaluates the declared CommonJS server entry. Modules require one server entry and at least one browser entry, unless explicitly declared `clientOnly`. The browser loader waits for styles and scripts before hydration and deduplicates concurrent loads. It may also fetch `<baseUrl>/manifest.json` when no manifest is supplied.

For custom server integrations, `resolvePinnedBuilds(options, dev?)` from `hadars/composition/build` performs the same validation and returns the same descriptors. Pinned filesystem loading is integrated with `dev`/`run`. The edge export embeds public client metadata and stages client assets as described below; static site export does not automatically assemble pinned files.

## Module manifest

A module describes itself in `hadars.manifest.ts` at its project root. Building, routing and typing all read it, so a shell does not repeat per-module configuration.

```ts
import { defineManifest } from 'hadars/composition';

export default defineManifest({
    name: 'admin',
    exposes: { routes: 'src/routes.tsx', UserBadge: 'src/UserBadge.tsx' },
    shared: ['design-system/components'],
    requires: { react: '^19' },
    mounts: ['/admin/**'],   // paths this module owns
    routes: 'routes',        // the exposes entry holding its route table
    uses: ['billing'],       // modules it embeds as components
});
```

- `exposes`, `shared`, `requires`, `clientOnly` are the existing `composition` fields; `buildModuleFromManifest(dir, { outDir })` (from `hadars/composition/build`) builds the module they describe. `loadManifest(dir)` returns the validated manifest.
- `mounts` use the split pattern grammar (`/x` or `/x/**`). When a shell's `split` has `mode: 'per-module'`, modules without an entry in `split.mounts` take the mounts from their pinned manifest; an explicit `split.mounts[name]` overrides it. Modules without mounts must still be `clientOnly`.
- `routes` must name an `exposes` entry and requires `mounts`.
- `uses` lists other modules this one embeds. The consumer still reaches them through `getModule` (the shell owns the instances); the list lets tooling check the graph. Pinning refuses a lock where a used module is missing, and `orderManifests(manifests)` rejects cycles and returns a dependency order.
- `mounts`, `routes` and `uses` are part of the build identity when present. Builds that declare none keep their identity.

### Declarations

`emitModuleTypes({ manifest, cwd, outDir, tsConfig? })` emits `.d.ts` files for everything a module exposes under `<outDir>/types`, with an entry (`types/index.d.ts`) whose namespaces mirror `getModule(name)`. Pass the result to `createModuleBuild({ ..., moduleTypes })`: the declarations become part of the immutable build (`types`, `typeApi`), so a consumer type-checks against the pinned version rather than the module's sources.

A shell writes one generated file from the builds it pins:

```ts
writeShellTypes('src/hadars-modules.d.ts', { admin: '.hadars/builds/<buildId>/types/index.d.ts' });
```

It declares the global `HadarsModules` interface, which types `getModule('admin')`. Unknown names still fall back to `getModule<T>(name)`.

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

The shell must run `hadars dev`. The override uses the local server entry and client manifest instead of the pinned module and drops pinned SRI values. It supports Fast Refresh in ESM projects (`"type": "module"`), reload fallback, and updated SSR. The generated HMR client uses `import.meta.webpackHot`; no generated-file rewrite is needed. An initial compilation error rejects module dev startup and makes shell dev exit nonzero with a compilation diagnostic. Overrides must name pinned modules and are ignored in production. The pinned set is still validated. Pinned inputs, generated declarations and configured module output survive dev restarts (see cleanup policy below).

## Runtime boundaries

Use `hadars/composition/runtime` for client loading, registration, shared packages
and `ModuleHead` in browser or edge shells. It has no Node imports, including in
CommonJS builds. No resolver alias is needed. The existing `hadars/composition`
entry remains compatible with Node shells; it also exports the filesystem loader.

`loadServerModule` (directory or descriptor), `resolvePinnedBuilds`, and reading
pinned `buildsDir` are filesystem-bound. Import these from
`hadars/composition/build` in Node tooling. The edge handler accepts bundled data;
it must never resolve a pinned directory at request time. Edge export statically links pinned server bundles and registers them before
`getInitProps` or rendering. Use `getModule(name)` from the runtime entry in both
paths; app code does not need a filesystem loader or a target-specific branch.

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

## Pinned edge export

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

Pinned server entries are compiled from verified snapshot bytes into a generated
link module and bundled into the shell's single server script. No artifact
paths, filesystem imports, or request-time directory resolution are needed.
The link module registers lazy factories before handling requests. The first
`getModule('greeter')` in `getInitProps` or the render path evaluates the module;
subsequent lookups return the same exports. Dev/run installs equivalent lazy
loaders and observes rebuilt files on subsequent requests. `loadServerModule`
remains supported for explicit Node loading by directory or descriptor.

Shared imports remain references to the shell's `provideShared` values, including
React and JSX runtimes. Publish these values before calling `getModule`; a module
must declare additional shared specifiers when it is built. Linking does not
resolve those specifiers to another package copy. The shell can publish providers
at module initialization or in `getInitProps` before its first module lookup.
Browser registration still uses `loadClientModule` and `registerModule` before
hydration. Return only `req.pinnedClients[name]` as client props.

A missing server entry or unsupported dependency fails export with
`CompositionLinkError` (exported by the build entry), including the module name.
Server byte tampering or missing artifacts fails integrity validation before
linking or staging assets. Static relative dependencies inside the verified
artifact are supported; unresolved externals, filesystem dependencies and dynamic
loading are rejected. Rebuild modules with the required packages declared shared
or with dependencies bundled for a filesystem-free runtime.

Declare `composition.clientOnly: true` when building a module that deliberately
has no server render path. `buildModule` omits its server entry, and
`createModuleBuild` records `clientOnly: true` in the immutable manifest. Such
modules retain public client assets and descriptors but receive no server
registration. Render a shell placeholder for them and load them in the browser.
The optional true flag participates in content identity before declaration
metadata; manifests without it retain their existing identities.

Export prints each linked module's build ID, generated linked byte size and
total byte size of its verified server inputs. `.hadars/static/composition-provenance.json` records the
snapshot, shell and module build IDs, linked server file sizes/SHA-256 hashes,
and staged client file sizes/hashes. It contains artifact-relative filenames
only, with no local directories. Server bytes are never copied into public
output. Custom export tooling can supply `{ file, runtime }` as the third argument
to `assemblePinnedExport`: `file` receives the generated link module, and
`runtime` names the filesystem-free runtime entry. Import that link module into
the shell's server entry before handling requests.

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

## Output retention

Set `moduleOutputDirs` in the app configuration to retain module staging and build
output during both `dev` and `build`. Paths are relative to the project working
directory, or absolute. This also protects nested directories within owned output:

```ts
export default {
    entry: 'src/App.tsx',
    moduleOutputDirs: ['module-output', '.hadars/modules', '.hadars/static/modules'],
};
```

Hadars owns and cleans `.hadars/static` (compiled client assets and exported static
files) and `.hadars/.ssr-modules` (temporary server imports) on dev/build startup.
Configured module directories and pinned inputs inside those directories are
excluded from cleanup, including their parents. Other contents of `.hadars` are
retained, including unknown user directories, `builds`, `types`, `integrity.json`
and `tsconfig.json`. Root server bundles/chunks are generated files that the
compiler may replace; `.hadars-lock.json` is managed by the running process.
Keep module filenames separate from generated shell filenames. Cleanup never
traverses symlinks to prune preserved inputs. `buildModule` and
`startModuleDevServer` do not clear their `outDir`.

## Compatibility errors

`CompositionCompatibilityError` is exported from `hadars/composition/build`
alongside the Node tooling that throws it. It extends `Error`, keeps the existing diagnostic message,
and sets `name` to `CompositionCompatibilityError`. Lock assembly, pinned
resolution, dev override checks and export use it for compatibility failures;
integrity and malformed-file errors remain ordinary errors.

Its readonly fields are `module` (the affected build name), `package` (the shared
specifier, when relevant), `requiredRange`, `providedVersion`, and `kind`:

- `version`: a package version is missing or does not satisfy its range.
- `contract`: an unsupported manifest runtime contract; requiredRange is `1 | 2`.
- `flavour`: an unsupported flavour, a dev build in production, or a module whose
  flavour differs from its shell. The fields contain the allowed and actual values.
- `shared`: a shared package has no shell provider.

Fields without an applicable value are `undefined`. Contract 1 and contract 2
may coexist because they share the same runtime ABI. Assembly validates supported
contracts/flavours and matching shell/module flavours; resolution additionally
enforces the requested dev/production mode.

```ts
import { verifyLockfile, CompositionCompatibilityError } from 'hadars/composition/build';

try {
    await verifyLockfile(pinnedOptions);
} catch (error) {
    if (error instanceof CompositionCompatibilityError) {
        console.error(error.kind, error.module, error.package,
            error.requiredRange, error.providedVersion);
    }
    throw error;
}
```

## Bundled runtime configuration

Single-file server exports project the config onto the options consumed by the
request handler: `fetch`, `proxy`, `proxyCORS`, `cache`, `onError` and `onResponse`.
Compiler plugins, rules, transforms, source hooks, static path generation and
other build options are evaluated during compilation only. Their imports and
eager initializers are excluded from the generated runtime config. Server module
registration is independent of this projection.

Use a declarative config object, optionally held in local variables with local
object spreads or conditional objects. Runtime hooks retain their closure
bindings and imports. A dependency used by a runtime hook is a real runtime
dependency: it must work in the target runtime. The exporter does not stub or
exclude filesystem APIs used by those hooks or by linked server modules.

If the default config is assembled by a function, imported spreads, mutations or
other top-level effects, export a separate declarative `runtimeConfig` object:

```ts
export const runtimeConfig = {
    fetch: request => request.pathname === '/health'
        ? new Response('ok') : undefined,
};

export default assembleBuildConfig({
    ...runtimeConfig,
    // Compilation options go here.
});
```

The export uses only that object's dependency graph. Put required runtime
initialization in a module imported by a retained binding, or inside a runtime
hook; standalone side-effect imports and top-level statements in the config are
not a runtime initialization mechanism. Unsupported config shapes fail with a
diagnostic instead of bundling the entire build configuration. Direct adapter
calls still receive the options supplied by the caller.

The module-reference regression scan covers both bare and `node:`-prefixed
`fs`/`path` imports, dynamic imports and requires. It includes a composed export
with a compiler plugin that uses both modules, then executes the exported
handler with its pinned directories unavailable. Earlier checks that covered
only filesystem imports could miss path-only compilation dependencies.

## Verify completed output

Composed single-script exports seal the existing `composition-provenance.json`
after bundling. Existing provenance fields remain available to older readers.
The additive `output` object has format `version: 1`, an `entry` record containing
the script's relative path, SHA-256 and byte size, and a `static` record containing
the static directory, its complete sorted file inventory, and its SHA-256 digest.
The inventory digest hashes UTF-8 JSON of `[relativePath, sha256, size]` tuples,
sorted by relative path using code-unit order and forward slashes. It includes
nested files and the HTML template. The provenance file itself is excluded to
avoid a circular digest. Symbolic links and special files are rejected.

Use the public build helper `verifyExport(directory, metadataPath,
expectedMetadataSha256?)` or the CLI subcommand
`composition verify-export directory metadataPath [expected-checksum]`.
Paths in metadata are relative to the export working directory; keep the script,
static directory and metadata in that layout when moving them. The verifier
reports missing/extra static files, hash and size differences, and changed or
missing entry scripts. Metadata without output records requires a fresh export.

`output.metadataSha256` hashes canonical metadata with that checksum and the
reserved `output.signature` field omitted. Canonical JSON recursively sorts object
keys and preserves array order. This detects accidental metadata edits, including
provenance edits; whitespace and object-key order are immaterial. A deployment
tool should retain this checksum through a trusted channel and supply it when
verifying: anyone able to replace both output and metadata can recompute an
untrusted checksum. A detached signature in `output.signature` is a future
extension; signing and signature verification are not implemented. All other
metadata fields are covered by the checksum.
