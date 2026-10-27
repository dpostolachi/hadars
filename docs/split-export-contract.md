# Split export contract v1

This document describes the implemented per-module export, independently of any
hosting service. The export working directory contains `units/`,
`.hadars/split-manifest.json`, `.hadars/static/`, `shell/artifact/`,
`shell/manifest.json`, and `hadars.lock`. No routing script, upload,
activation, browser release gating, or detached signature verification is supplied.
The later proposal in split-deployment.md does not extend this contract.

## Manifest

All fields below are required. No optional manifest fields are emitted. JSON
object property order has no semantic meaning; the seal hashes the actual bytes,
including whitespace. The writer uses `JSON.stringify(manifest, null, 2) + '\n'`.
Unknown properties are not rejected by the current verifier; they remain sealed.

| Field | Type and value |
| --- | --- |
| `version` | number, exactly `1` |
| `releaseId` | string, 16 lowercase hexadecimal characters |
| `mode` | string, exactly `per-module` |
| `defaultGroup` | safe group name string |
| `shell` | string, pinned shell build ID, equal to provenance `shell` |
| `snapshot` | string, pinned snapshot ID, equal to provenance `snapshot` |
| `probe` | object with required `path`, exactly `/__hadars/release` |
| `budgets` | object with required `unitBytes`, a positive safe integer (at most 9007199254740991) |
| `groups` | ordered array of group records below |

`budgets.unitBytes` is the release-wide uncompressed per-unit limit: the configured
value or `9_000_000`. Export rejects a final unit larger than this value. Replacing
the fixed-length release placeholder preserves its byte size. Verification also
checks the budget. The budget is sealed through the manifest bytes, but excluded
from release identity: it is deployment policy, not executable code or routing.
Changing policy requires a new seal, even when release identity stays the same.

Every group record has required `name: string`, `patterns: string[]`,
`modules: string[]`, and `unit: {file: string, sha256: string, size: number}`.
Names are unique and match `[A-Za-z0-9_~-][A-Za-z0-9._~-]*`, excluding `.` and `..`.
The default group occurs exactly once, last, with empty patterns and modules.
Every other group has nonempty patterns and `modules: [name]`; its module is a
pinned module. Unmounted modules must be declared client-only in their build.
`unit.file` is exactly `units/<name>/bunny.mjs`, `sha256` is the SHA-256 of the
final file bytes (64 lowercase hex characters), and `size` is its byte count,
a nonnegative safe integer no larger than the budget.

Non-default groups sort by descending length of their longest literal prefix,
then by name using JavaScript code-unit comparison (`<`, `>`). Pattern arrays
preserve configuration order, including same-group duplicates or overlaps.
Modules have the singleton/empty ordering above. Units in the seal use this same
group order.

## Shell identity

Split export pins its own shared production compile before bundling units or
computing release identity. The earlier shell pin supplies name, provides map,
runtime contract, shared/exposed specifiers and requirements; its compiled bytes
and build ID are replaced. Module and library manifests/pins remain unchanged.
The public `createShellBuild` and `assembleLockfile` helpers compute the final
native manifest, build ID, snapshot ID, snapshot checksum and lock content.
Every unit embeds this final shell ID, and manifest, release identity and
provenance use the final shell and snapshot IDs. No post-export re-pin is needed.

The shell artifact has precisely this file set (relative to `shell/artifact`):

- `server/`: top-level `.hadars/` files matching `^.+\.ssr\.(js|css)$`,
  including the `index.ssr.js` entry and SSR chunks used by unit bundling.
- `client/`: the complete `.hadars/static/` tree, recursively excluding entries
  named `_builds` or `composition-provenance.json`. This includes HTML, assets,
  generated files and project static files, as well as JS/CSS chunks.

Client targets are the top-level client JS/CSS files. Server targets are
`server/index.ssr.js` and top-level server CSS files. Every artifact file has its
SHA-256 and byte size in the native build manifest. Client bytes are copied
from the same static output that is sealed; server bytes are copied from the
same compile that the units bundle. Module assets are staged after shell pinning.
Assembly provenance is excluded to avoid hashing the shell's own identity.

The default split CLI emits `shell/artifact/`, `shell/manifest.json`, and the final
`hadars.lock` in the export working directory, covered by `output.shell` below.
The immutable build is also retained in the configured builds directory. The
configured input lock is preserved unless it is the output `hadars.lock` itself;
that path intentionally receives the final lock. A private `.hadars/export.lock.json`
feeds native unit assembly and is outside the deployment inventory.

`export <target> --no-emit-shell` skips copying the artifact, manifest and final
lock to deployment paths, and omits `output.shell`. It still computes and uses
the final shell/snapshot identity. It removes a previous `shell/` output but does
not delete a preexisting `hadars.lock`, which may be an input. Verification in
this mode has only the original v2 guarantees, since pin files are absent.
Single-unit exports keep the existing v1 output and byte behavior; emitting a
shell build for single-unit exports is not implemented.

## Routing grammar and native translation

A pattern is `/`, or slash-separated `[A-Za-z0-9._~-]+` literal segments with an
optional final `/**`. `/` and patterns without the suffix match exactly. A suffix
matches both its literal prefix and any pathname starting with that prefix plus
`/`. Empty segments, trailing slashes, other wildcards, query/fragment characters,
backslashes and percent escapes in patterns are invalid. Literal dot segments
are allowed and are not normalized by the matcher.

Literal prefixes must be prefix-free across different groups in this version,
even for exact patterns whose languages would not intersect. Equal prefixes and
strict segment-wise ancestor prefixes fail with `SPLIT_PATTERN_NESTED`.
`/a` is an ancestor of `/a/b`, but not `/ab`; `/` is an ancestor of every mount.
Patterns within one group may overlap. Nested mounts across groups are a later
extension requiring explicit per-pattern plan ordering.

`routingPlan` returns `[{group: name, patterns: [...patterns]}, ...]` in manifest
order, including the final empty-pattern fallback. `matchGroup` selects the first
matching group or the default. Prefix freedom makes this equivalent to selecting
the matching pattern with the longest literal prefix.

For native rule translation, emit one equality rule for an exact pattern. Expand
`/a/**` into adjacent rules `pathname == '/a'` and
`pathname startsWith '/a/'`, both targeting the same group. Preserve plan and
pattern order and finish with the fallback. These are semantic rules, not a
provider wildcard syntax. A translator must demonstrate equivalent behavior or
reject the configuration. Matching uses the case-sensitive raw pathname, strips
query and fragment suffixes, and never decodes escapes, removes dot segments or
collapses slashes. `/a//b` and `/a/%2F` match `/a/**`; `/ab`, `/A`, `/%61` and
`/a%2Fb` do not. URL parsers may normalize paths before this helper receives them;
translators must account for their actual ingress behavior.

## Sealed metadata output version 2

The existing `composition-provenance.json` contains `snapshot`, `shell`,
`modules`, and `output`. Module provenance retains the existing format: a map
from module name to `{buildId: string, clientOnly: boolean, server: File[],
client: File[]}`, where those input `File` records have `{path, size, sha256}`.
All provenance fields, including extensions, participate in the metadata checksum.
This document versions the `output` member, not the enclosing provenance format.

| Output field | Type and requiredness |
| --- | --- |
| `version` | required number, exactly `2` |
| `shell` | optional `ExportFile[]`, complete `shell/` inventory in ascending path order followed by `hadars.lock`; emitted by default for new split exports |
| `units` | required `ExportFile[]`, in manifest group order, one per group |
| `manifest` | required `ExportFile`, path `.hadars/split-manifest.json` |
| `static` | required `{directory: string, files: ExportFile[], sha256: string}` |
| `metadataSha256` | required string, SHA-256 checksum below |
| `signature` | optional, reserved, any JSON value; excluded from checksum; not emitted or verified |

`ExportFile` has exactly the emitted fields `{path: string, sha256: string,
size: number}`: relative path, SHA-256 of actual bytes, and actual byte count.
Shell, lock, unit and manifest paths are relative to the working directory. Static file paths
are relative to `static.directory`, emitted as `.hadars/static`. Paths use `/`,
must be nonempty, cannot be absolute or contain backslashes, NUL, empty, `.` or
`..` components. Symbolic links and special files are rejected. Unit paths must
be unique; manifest group records must agree with sealed unit records.
The writer emits the fields in the order shown in the table and ExportFile
spelling above; consumers must not depend on object key order.

Static inventory recursively includes every regular file under the static
directory except the provenance file itself. It sorts paths ascending with
code-unit comparison. Neither the manifest nor units are inside this inventory.
The provenance exclusion prevents a checksum cycle; its contents are protected
by `metadataSha256` instead. The digest is lowercase SHA-256 of UTF-8 bytes of:

```js
JSON.stringify(files.map(f => [f.path, f.sha256, f.size]))
```

## Canonical JSON and identity

The existing [version 1 metadata checksum algorithm](composition.md) is unchanged.
`canonical` recursively sorts object keys using JavaScript `localeCompare`,
retains array order and uses compact `JSON.stringify`, without a trailing newline.
It is the existing algorithm, not a new canonicalization standard. Consumers must
match its key ordering (including locale behavior for non-ASCII extension keys).
SHA-256 always consumes UTF-8 bytes for strings and returns lowercase hex.
The exact implementation is:

```js
const canonical = value => JSON.stringify(value, (_, v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
    : v);
const { metadataSha256, signature, ...output } = metadata.output;
const checksum = sha256(canonical({ ...metadata, output }));
```

Only `output.metadataSha256` and `output.signature` are omitted. Object indentation
in the provenance file does not affect this checksum. Retain the checksum through
a trusted channel: an attacker able to rewrite files and the checksum can reseal
an export. Signatures are reserved and provide no current authentication.

Release identity avoids circular hashing:

1. Bundle every unit with the exact 16-byte constant `SPLITRELEASE0000`, present
   exactly once in each UTF-8 script. Hash these placeholder bytes and record sizes.
2. Use full ordered group records (`name`, `patterns`, `modules`, `unit` including
   its path, placeholder SHA-256 and size) in the canonical input
   `{groups, shell, snapshot, static}`. `static` is the inventory digest string.
3. Hash canonical JSON of that input and take its first 16 hex characters as
   `releaseId`. No other manifest fields enter this input.
4. Replace the single placeholder in each unit with this ID. Record the SHA-256
   of final bytes in the manifest, write the manifest, then seal it and all units.

Verification reverses the replacement to reconstruct normalized unit hashes.
Pattern/module array order and group order are identity inputs. Budget and probe
policy do not enter the identity; actual code embedding probe behavior does.

## Verification procedure

`verifyExport(directory, metadataPath, expectedMetadataSha256?)` does the following:

1. Validate the relative metadata path, reject unsafe path components/symlinks,
   read and parse provenance, and require supported output version (1 or 2).
2. Recompute the canonical metadata checksum and compare with its stored value
   and the optional trusted checksum. Stop immediately on mismatch.
3. Validate output paths and uniqueness; read every unit and manifest, checking
   actual SHA-256 and byte size. Accumulate changed/missing entry errors.
4. Inventory `units/`; reject any file absent from the seal. Parse the manifest,
   validate routing grammar, cross-group prefix freedom and group order; require
   manifest version/mode/probe/release shape and a positive safe integer budget.
5. Check shell/snapshot against provenance. Compare the manifest's ordered units
   to the seal. Check exact per-group file paths, module membership and sizes
   against the budget. Require exactly one embedded release occurrence per unit,
   reconstruct placeholder hashes and recompute release identity.
6. When `output.shell` is present, inventory the complete `shell/` tree and lock,
   compare sealed hashes/sizes and reject extra artifact files. Require a native
   shell manifest whose computed build ID equals manifest `shell`. Check all
   artifact hashes/sizes and byte equality of each client file with shared static
   output. Reassemble the lock natively and require exact content and final
   snapshot equality. Compare module pins with unit-link provenance build IDs
   and server input hashes with their pinned manifests. Older v2 exports without
   this optional field remain supported.
7. Validate unique static paths and inventory actual regular files, excluding
   provenance. Report missing, changed or extra files. Check both the declared
   inventory digest and actual inventory digest against the sealed static digest.
8. Throw accumulated differences if any; otherwise return the sealed output.

The verifier does not execute scripts or probe deployments. It does not validate
all unknown metadata or schema extensions, authenticate signatures, or ignore
extra files within `units/` or the static inventory. Unrelated working-directory
siblings (such as the fixture's `expected.json`) are outside the seal.

## Runtime and errors

Every generated unit wraps its application handler with the shared runtime.
`GET /__hadars/release` (query permitted) returns 200 JSON
`{release: releaseId, group: name, shell: shellId}`, content type
`application/json`, and `Cache-Control: no-store`, before hooks, proxies or
application caches. Other methods follow the application handler. Every returned
response, including application hook/proxy/error responses, gets
`x-hadars-release` and `x-hadars-group`. Other responses retain their cache policy;
uncaught handler exceptions still propagate. Development uses `dev-all` for
release/group and logs the reference group decision.

The exact named split error codes are:

| Code | Trigger |
| --- | --- |
| `SPLIT_MODE_INVALID` | unsupported mode |
| `SPLIT_PINNED_REQUIRED` | no pinned shell builds/lock |
| `SPLIT_MOUNTS_INVALID` | mounts is not a record |
| `SPLIT_DEFAULT_INVALID` | unsafe/empty default name |
| `SPLIT_DEFAULT_COLLISION` | default also mounted |
| `SPLIT_DEFAULT_MISSING` | default absent from groups |
| `SPLIT_GROUP_INVALID` | invalid/duplicate group name |
| `SPLIT_GROUP_ORDER` | incorrect group order |
| `SPLIT_PATTERNS_INVALID` | incorrect empty/nonempty pattern array |
| `SPLIT_PATTERN_INVALID` | pattern outside grammar |
| `SPLIT_PATTERN_NESTED` | cross-group equal or ancestor literal prefixes |
| `SPLIT_MODULE_UNKNOWN` | mounted module absent from pins |
| `SPLIT_MODULE_UNMOUNTED` | non-client-only module not mounted |
| `SPLIT_BUDGET_INVALID` | missing/invalid manifest budget or invalid configured budget |
| `SPLIT_SIZE_EXCEEDED` | unit exceeds budget |
| `SPLIT_RELEASE_PLACEHOLDER` | bundle lacks exactly one placeholder |
| `SPLIT_TARGET_UNSUPPORTED` | split requested for unsupported export target |

Overlap errors are exactly `SPLIT_PATTERN_NESTED: <p1> (<g1>) and <p2> (<g2>)`
in validation encounter order. Size errors at export have name
`SplitSizeExceededError` and message `SPLIT_SIZE_EXCEEDED: <group>: <size> unit
bytes, <linkedSize> linked module bytes > <budget> budget bytes`.

Verification retains the existing descriptive errors rather than assigning new
codes: `Export metadata unreadable: ...`, `Export metadata missing or unsupported
output version`, `Export metadata checksum mismatch`, `Invalid export path: ...`,
`Duplicate output file: ...`, `Duplicate static file in metadata: ...`.
Accumulated errors start `Export verification failed:\n` and contain
`Entry script changed: ...`, `Missing entry script: ...`, `Extra unit: ...`,
`Split output invalid: ...`, `Static output unreadable: ...`,
`Missing static file: ...`, `Static hash mismatch: ...`, `Extra static file: ...`,
`Static inventory digest mismatch in metadata`, or `Static output digest mismatch`.
Split validation details retain their codes inside `Split output invalid: ...`;
other details include `Invalid split manifest`, `Split manifest composition
identity mismatch`, `Split manifest units differ from seal`, `Invalid split unit
membership: ...`, `Invalid embedded release: ...`, and
`Split release identity mismatch`. Filesystem/parser details may accompany these.

## Committed conformance vector

`test/fixtures/split-export/` is a complete sealed working directory plus
`expected.json`, containing literal release, final and normalized unit hashes,
sizes, final shell/snapshot identities, shell inventory, manifest/static/metadata digests, routing plan and 36 pathname results.
The conformance test reads this fixture without generating or updating it and
mutates copies to check every exported file class.

Generate from the repository root with `bun scripts/gen-split-fixture.ts`.
The generator uses real build creation, lock assembly and pinned client export,
bundles miniature adapter-neutral handlers with the real runtime, and calls
`completeSplitExport`, the same release patching and sealing code used by the CLI.
It deliberately omits the full application/adapter graph to keep each unit below
1 KB. These scripts export a default Request-to-Response handler. The integration
test separately covers full application and adapter bundles.

The committed vector was generated with esbuild 0.27.4. There are no timestamps,
absolute build paths or random content. With the installed dependencies the script
reproduces it byte-identically; an optional destination argument supports a clean
comparison: `bun scripts/gen-split-fixture.ts /tmp/split-vector` followed by
`diff -r test/fixtures/split-export /tmp/split-vector`. Dependency upgrades may
change bundle bytes and must deliberately update the vector and its literals.
