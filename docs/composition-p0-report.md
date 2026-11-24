# Composition implementation report

## Item 1 — complete

Added `hadars/composition/runtime`, a filesystem-free runtime entry in both package
formats, and separated the server loader into its own source file. Existing Node
imports remain compatible; the build entry also exports the server loader.
Documented filesystem-bound functions and the edge handler boundary. The handler
has no composition filesystem imports and will accept public bundled metadata in
item 4. Browser-target esbuild test verifies the runtime has no Node/filesystem
references. `bun test`: 324 pass, 0 fail. `bunx tsc --noEmit`: diagnostics identical
to the captured baseline (package.json has no typecheck script).

## Item 2 — complete

Added aliases, explicit tsconfig path resolution, and the app SWC plugin list
shape to the shared module build/dev configuration. Both targets run WASM plugins
before transforms. Documented precompiled exposed entries for function transforms.
A real query-transform plugin test executes both outputs and combines alias and
tsconfig path imports. Added a pinned development-only plugin dependency.
`bun test`: 325 pass, 0 fail. Typecheck diagnostics remain identical to baseline.

## Item 3 — complete

Added public immutable artifact builders for module output and compiled shells,
integrity maps, shared v1 identity computation, lock assembly and verification.
Shells must contain real files and declare shared provides. Existing artifacts
are checked and reused, never overwritten. The CLI can build artifacts, assemble
locks, and verify them without app config. Documented the exact v1 identity order;
no contract changes. Tests cover round trips, unchanged v1 hashes, shell pinning,
tamper detection, duplicate names, immutability and CLI verification.
`bun test`: 329 pass, 0 fail. No new typecheck diagnostics; existing diagnostic
union ordering may vary, but the error locations and codes remain unchanged.

No commits or external publication.

## Item 4 — complete

The edge export validates the full pin set, rejects missing/changed/undeclared
files, copies only module client assets under their content-derived build paths,
and embeds public client descriptors with derived SRI. The handler exposes these
as request.pinnedClients; dev/run and SSR workers expose the same property.
No server descriptors are embedded. Documented future static server registration.
Tests cover missing files, same-size tampering, undeclared files, public metadata,
asset copying, and an actual CLI export rendered after deleting pinned directories.
The exported composed shell has no filesystem reference and needs no resolver alias.
`bun test`: 332 pass, 0 fail. `bun run build:all` succeeds including declarations.
No new typecheck diagnostics in changed files.

## Item 5 — complete

Modules can declare package ranges and shells can provide exact versions. All
resolution paths and lock assembly reject incompatible pairs with package, range
and provided version in the message. Dev overrides read their build's version
metadata; module tooling can infer exact requirements from resolved dependencies.
Versioned provides use manifest runtime contract 2, with a sorted map in identity.
The v1 lock envelope and all v1 identities remain unchanged and supported.
Tests cover compatible/incompatible pairs in production, dev and export, override
requirements, and installed dependency inference. `bun test`: 335 pass, 0 fail.
`bun run build:all` passes. Full `bunx tsc --noEmit` retains the same 62 pre-existing
error locations/codes as baseline; no diagnostics were added in touched files.

## Final scope

Items 1–7 and the named compatibility error are implemented. Static server registration remains a documented
extension point. Items 6 and 7 are covered by the follow-up work below. All changes are uncommitted;
no pushes, remote comments, issues, publication or deployment actions occurred.

## Follow-up item 6 — ESM dev HMR complete

The generated module dev client uses the parser-supported `import.meta.webpackHot`
API, including when its output lives in an ESM package scope. The existing browser
fixture now supplies `type: module` and verifies Fast Refresh, retained shell state,
reload fallback and updated server rendering without editing generated files.
Module startup rejects failed initial stats and closes both watchers and its HTTP
listener. Shell client and SSR startup also reject failed initial compilation;
the CLI exits nonzero with a clear diagnostic instead of accepting completion.
Added module rejection and failing-shell CLI tests. `bun test`: 337 pass, 0 fail.
Typecheck retains the baseline diagnostics. Nothing remains for this item.

## Follow-up item 7 — output retention complete

Added `HadarsOptions.moduleOutputDirs` for relative or absolute staging/output
paths. Dev and build now use one cleanup policy: only `static` and `.ssr-modules`
are pruned, with configured module paths and pinned inputs excluded recursively.
Unknown user directories under `.hadars` are retained by default. Root compiler
outputs can be replaced by compilation; module filenames should stay separate.
Documented ownership, symlink handling and module helper outDir behavior.
An actual dev/build fixture checks configured paths outside and under `.hadars`,
a nested path within static output, an unconfigured user directory, and removal
of stale generated output. `bun test`: 338 pass, 0 fail. Typecheck matches the
baseline. Nothing remains for this item.

## Follow-up version contract — named compatibility error complete

Exported `CompositionCompatibilityError` and its typed details from the build
entry. It extends Error and retains existing messages, with readonly module,
package, requiredRange, providedVersion and kind fields. Resolver diagnostics
retain the class and fields when adding pinned-build context. Dev overrides and
export preserve it too. Lock assembly now checks supported runtime contracts and
flavours and shell/module flavour agreement as well as versions. Contract 1 and
2 remain interoperable; integrity failures remain ordinary Errors.
Tests assert the class, fields and diagnostic at version, contract, flavour and
missing-shared rejection sites, including assembly, resolver, overrides and
export. Documented field semantics and catch usage. `bun test`: 339 pass, 0 fail.
`bun run build:all` passes; typecheck has the same baseline diagnostics. Nothing
remains for the requested items. Static server registration remains a future
extension point. All changes remain uncommitted with no external writes.
