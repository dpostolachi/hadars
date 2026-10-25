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

No commits or external publication. Items 6 and 7 are outside scope.

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

Items 1–5 are implemented. Static server registration remains a documented
extension point. Items 6 and 7 remain outside scope. All changes are uncommitted;
no pushes, remote comments, issues, publication or deployment actions occurred.
