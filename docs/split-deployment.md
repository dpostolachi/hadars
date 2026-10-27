# RFC: split server deployment, one app release

Status: proposed. All APIs, commands and formats introduced here are proposals.
The existing single-server export remains the default. Target names below describe
capabilities: **edge-script**, **bound-worker**, and **function**; the adapters
retain their existing CLI target identifiers.

| Decision | Recommendation | Reason |
| --- | --- | --- |
| Membership authority | Declarative route table with stable page IDs | Connects dispatch paths to code without guessing application control flow |
| Server output | One self-contained unit per group | Independent memory, concurrency and bundle size |
| Browser output | One release-wide client chunk graph | Cross-group navigation preserves the app and shared state |
| Composition | One validated snapshot; link a subset per group | Remove unused server factories without mixing module versions |
| Activation | Stage a complete release, then apply a receipt-recorded native plan | Per-request coherence with release gating; strict atomic mode is optional |
| Failure | Fail closed; no fallback to another release | Availability must not conceal a partial deployment |
| Dispatch | Native routing plan executed by the deployment tool; router only as opt-in fallback | No extra hop, no extra failure point, no code in the request path |
| Integrity | Version 2 sealed output with a trusted checksum | Covers every group, static asset, route and composition pin |

## 1. Goals, limits and atomicity

Split an app by URL path into separately deployed and independently sized units.
Keep the shell, all groups, client assets and composed modules in **one release**.
Prevent rejection by a roughly 10 MB single-script limit, avoid parsing unrelated
pages on cold start, isolate crashes/resource exhaustion, and permit different
memory/concurrency settings for hot and infrequently used paths. Splitting reduces
the server graph, not necessarily total uploaded bytes: shared libraries duplicate.
Common external dependencies remain shared failure points. No routing script or
function sits in front of groups in the default deployment.

Non-goals: deploying a group independently, dynamically fetching server code,
distributed in-memory sessions/caches, automatic inference of arbitrary routers,
changing application URLs, or implementing infrastructure activation in hadars.
No promise of smaller bundles if the shared shell itself exceeds the budget.
About 50 subrequests per request is a planning constraint for the edge-script
target, not a fresh allowance for every hop. Splitting cannot evade that limit.

A release is a tuple of route/membership plan, immutable group units, one client
graph, one complete pinned snapshot, static inventory and runtime contract.
The deployment tool MUST stage and verify the entire tuple before activation.
Every destination is an immutable revision, never a mutable `latest` endpoint.
Each self-contained unit embeds its release/group IDs and the same client graph
and pinned snapshot identity. It handles a request entirely within that tuple;
there are no cross-group server calls to assemble a render.

**Scope of atomicity:** native routing with one API call per rule allows a short
window in which requests for different paths reach different complete releases.
On an edge-script CDN, one measured run on one provider on one day showed two
rule updates and a default-script pointer update, submitted sequentially over
about 1.2 s, becoming visible about 3.2–3.9 s after their respective calls and
within 165 ms of each other (about 0.2 s). This is a single sample, not a bound.
Updates straddling a periodic configuration sync boundary may have a longer
window. Measure repeatedly before claiming propagation or mixed-release bounds.
This window is acceptable ONLY with self-contained units and release gating:
no request ever executes a mixed tuple. It is not an atomic whole-map update.

HTML embeds its release ID and client graph ID. Framework data/navigation and
mutation requests carry the existing browser release selector. Before **any**
hook, cache lookup, proxy or render, a unit compares that selector to its embedded
release ID and checks native destination/group context. A mismatch returns
`409 SPLIT_RELEASE_MISMATCH` with `Cache-Control: no-store`; an expired selector
returns `409 SPLIT_RELEASE_EXPIRED`. The browser performs one document reload
using the release-selector protocol, clearing the stale selector for the fresh
document; it never replays a mutation. Bound reload attempts to one per failed
navigation; if propagation still causes a mismatch, show a clear retry error.
A document request without a selector adopts the unit's release. In-flight
requests keep their selected unit/release through completion. A public
selector is a consistency assertion, never a destination address or credential.
Native routing need not keep old tabs on old units: if it cannot select a retained
release natively, old tabs reload. Retain old units/assets for in-flight work,
rollback and any supported native release affinity. No silent cross-release retry.

The deployment tool MUST use this deterministic activation protocol:

1. Verify the seal; stage **all** immutable group units, static assets and runtime
   configuration. Probe each unit and validate the full new plan before writes.
   Snapshot/read back every old rule, its precedence and the default pointer.
   Lock deployment ownership or use conditional revisions; abort on conflicting
   writers. Record old/new values and request identifiers in a durable receipt.
2. Build an edit script over the union of old/new non-default patterns, sorted
   by section 4 precedence and lexical tie-breaks. For each pattern, update its
   stable rule ID, create it if new, or delete it if removed; expanded native rules
   use their recorded adjacent expansion order. Apply that fixed order, waiting
   for each API acknowledgement and recording each step. Validate intermediate
   maps against old/new group ownership, including visibility combinations when
   propagation reorders writes. Reject an edit script that could send a path to a
   unit lacking its page; each unit also checks local ownership before hooks. Use a staged native map or
   strict mode if a membership change cannot be updated safely in place.
3. Flip the default-script pointer **last**. This keeps unmatched traffic on the
   old release until explicit rule calls have succeeded and gives one final
   catch-all step to reverse first. API order does not guarantee visibility order;
   release gating is mandatory throughout propagation and rollback.
4. Read back **every** rule and the default pointer, comparing normalized actions,
   patterns, precedence and immutable unit identities with the receipt. Probe
   each group's witness URLs through the **public hostname**, using a reserved
   release-probe header or path that returns embedded release/group/client graph
   IDs before app hooks. Bypass caches and check expected release, not just 200.
   Repeat until convergence or a configured deadline; only then mark activated.
5. On any API failure or verification timeout, stop forward writes and restore
   applied steps in **reverse order**, including the default pointer first if
   changed. Each idempotent step records intent, acknowledgement and readback;
   reconcile ambiguous timeouts by readback before retry/undo. A rollback failure
   leaves an explicit incomplete receipt, raises an operational error and resumes
   reconciliation; never report success or delete either release. Verify all old
   rules/pointer and public probes again. Conditional writes must not overwrite
   another owner's intervening change; surface that conflict for reconciliation.

A receipt binds the output seal and plan/translation digests to all provider
resource revisions, resolved unit identities, runtime config revision, ordered
forward/undo steps, readbacks and timestamped probe results. Rollback uses the
previous verified receipt, not reconstructed mutable aliases. Hadars supplies
artifacts and verification helpers; the deployment tool owns provider calls.

**Optional strict-atomic mode:** stage a release-scoped hidden zone containing
the complete native rule map, default unit and asset policy; verify it before
changing **one** public ingress origin/zone-reference field. Rollback restores
that field to the retained zone. This costs an extra ingress-to-hidden-zone hop
(and associated latency, limits and failure surface), though it needs no routing
script. The provider's ability to address a hidden zone through one field and
retain coherent old/new maps is **to verify against provider docs before
implementation**. Reject strict mode if unavailable; never silently enable a
router. One field flip still propagates geographically: it does not promise a
globally simultaneous cutover or terminate old in-flight requests.

## 2. Current implementation and the proposed group model

Today `src/build.ts` compiles the configured `entry` twice: a browser bootstrap
under `.hadars/static` and the app entry as `.hadars/index.ssr.js`. The SSR entry
exports the component and `getInitProps`/`getFinalProps`; the browser entry also
uses `getClientProps`. Pages are application imports and routes are application
code, often a JSX `routes` value, not a declarative `HadarsOptions.routes` API.
Static page imports retain their dependencies on the server. The loader in
`src/utils/loader.ts` changes literal `loadModule` calls into browser dynamic
imports, but into `Promise.resolve(require(...))` on the server. Browser laziness
therefore does not remove server bytes. Nonliteral calls currently warn; split
mode must reject them when they could cross a page boundary.

`cli-lib.ts` builds first, then bundles a shim importing that SSR module, the HTML
template and projected runtime config into one target entry. Build-only config
bindings are excluded; runtime hooks retain their actual dependencies. All three
single-file adapters receive that app module. The function adapter buffers the
response and handles gateway event formats; the two edge adapters use web
requests/responses. Adapter capabilities are not currently identical.

`src/composition/exportBuilds.ts` validates the pinned set, stages public client
files and, through `linkServer.ts`, compiles verified server bytes into lazy
factories. All non-client-only module factories enter the single shell script.
Lazy registration defers evaluation, not byte inclusion. `provideShared` supplies
one package instance per shell runtime; `getModule` evaluates a registered factory
on first lookup. Dev/run use filesystem-backed lazy registration instead.
Page modules, shared libraries, retained runtime hooks and all linked factories
explain the current server size. See [composition](composition.md) and
[deployment-time configuration](deployment-time-configuration.md).

### Configuration and routing grammar

Add `split` to the app config; keep the existing `entry` as the shared wrapper and
lifecycle entry. A proposed framework `SplitOutlet` renders the route selected by
the generated registry. The wrapper uses this outlet for split-owned pages in
both server and browser builds. It may supply layouts/providers, but must not
independently choose a different page using a second router.

```ts
// Proposed fields within hadars.config.ts
export default {
  entry: 'src/App.tsx',
  split: {
    version: 1,
    defaultGroup: 'main',
    budgets: { serverBytes: 9_000_000 },
    pages: {
      home: { file: 'src/pages/Home.tsx', modules: [] },
      account: { file: 'src/pages/Account.tsx', modules: ['identity'] },
      missing: { file: 'src/pages/NotFound.tsx', modules: [] }
    },
    routes: [
      { pattern: '/', page: 'home' },
      { pattern: '/account/:id', page: 'account' }
    ],
    notFoundPage: 'missing',
    groups: [
      { name: 'account', patterns: ['/account/**'],
        pages: ['account'], modules: ['identity'], serverBytes: 7_000_000 },
      { name: 'main', patterns: [] }
    ],
    checks: [{ url: '/account/42', group: 'account', page: 'account' }]
  }
};
```

Group names and page IDs match `[a-z][a-z0-9-]{0,47}`; names are unique. `file`
resolves using the build resolver and must identify one canonical page resource.
Page `modules` lists exact names from the one pinned lock, including client-only
uses. Optional group `pages`/`modules` are additive explicit membership, useful
for error boundaries, common hooks and APIs; they cannot subtract derived needs.
Unknown names fail. No globs are accepted in the first configuration version.
Group `serverBytes` overrides the inherited budget. Capacity/memory settings are
external deployment policy keyed by group, recorded in the receipt.

Use the same reference matcher in analysis, generated clients, dev and tests:

- Match the URL pathname only, all methods, case sensitive. Query and fragment
  never affect selection. No host, regex, optional segment or method predicates.
- Grammar: `/` or slash-separated literal segments, `:name` (one nonempty
  segment), and an optional final `**` (zero or more whole segments).
  Names match `[A-Za-z][A-Za-z0-9_]*` and cannot repeat in a pattern. Literals
  contain only ASCII letters/digits and `-._~`; `.` and `..` segments are invalid.
  Thus `/account/**` includes `/account`, but never `/accounting`.
- At ingress, reject malformed escapes, encoded slash/backslash, raw backslash,
  controls, repeated slash and dot segments with 400 before URL normalization.
  Decode percent-encoded unreserved ASCII once, uppercase remaining escapes,
  and remove one trailing slash except at root. Match that canonical path;
  preserve the original raw path/query separately for the application. The outlet
  selects pages using the canonical path on both server and client. Never
  decode twice. Providers unable to expose or equivalently reject ambiguous raw
  paths cannot express `path-1` directly. Reject that native translation unless
  equivalent native ingress validation is available; no custom routing code is
  implied. Unit pre-hook validation is also required, but cannot correct a native
  routing choice made with different normalization.
- Rank matching patterns lexicographically by segment kinds from left to right:
  literal > parameter > rest; an exact end beats a rest matching zero segments.
  Ties whose languages overlap fail configuration, including `/a/:x` versus
  `/a/:y`; array order is not precedence. Different literals cannot tie on an
  actual request. Route-page selection and group selection use the same rules
  but separate tables. A missing group match selects `defaultGroup`; exactly
  one default is required and it may also have explicit patterns.

A route's matching language, minus higher-ranked routes, must be partitioned by
the group matcher. Include its page in **every** intersecting winning group,
not merely the group matching a sample URL. Implement this as intersection and
emptiness checks on segment automata; emit a witness URL for conflicts. Shared
layouts, error/not-found pages and wrapper dependencies are included in each
needed group. Render the common not-found page locally in the selected group
with 404; unmatched group paths use the default group. Never dispatch again to
render a 404. API/fetch/proxy paths use the group table even without a page route.

### Membership decision and consistency checks

| Approach | Advantages | Rejection or constraint |
| --- | --- | --- |
| Explicit page globs/lists alone | Simple migration; handles arbitrary source layout | Can omit a render dependency; globs silently grow; does not connect paths to pages |
| Declarative route table | Language intersection proves path coverage; generates a common selector | Selected authority; requires split-owned routing to adopt the outlet |
| Analyze `loadModule` call sites | Useful diagnostics and dependency edges | Cannot infer conditions, auth branches, wrappers or existing static imports; not routing authority |

For each group derive pages from route intersections, then add explicit pages,
not-found and declared error/layout dependencies. Traverse their resolved server
imports and the shared entry/hooks. An included page importing another declared
page requires that page in the group; report the chain and require an explicit
addition rather than silently changing route ownership. A wrapper directly
importing all pages bypasses the outlet and must fail strict analysis until moved
to the registry. Ordinary shared utilities remain ordinary dependencies.

A server-only bundler plugin replaces excluded canonical page resources with
export-shape-compatible stubs before their contents or dependencies are bundled.
Resolve aliases, re-exports and static/dynamic imports to the same resource;
check the final module graph for bypasses. Do not replace by string prefix or
just rewrite `loadModule`. Stub imports must not throw at initialization, since
unused route definitions can reference them; invocation/render/export access
throws `SplitMembershipError` with group, page, route and importer chain. Eager
use of excluded non-component exports is a build error. Code that needs shared
constants must move them out of a page module.

Strict export rejects opaque page loaders, unenumerated page context imports,
undeclared page references and separate render selectors it cannot validate.
Arbitrary application control flow cannot be proven by static analysis: do not
claim otherwise. Require local contract tests for declared dynamic branches,
including authenticated/anonymous states, layouts, error routes, HTML and JSON
renders. Build executes route witnesses and configured `checks` against actual
group entries with a stub-access trap; any access fails export. CI adds app-specific
fixtures for stateful branches. The generated selector proves declared routes;
tests validate the wrapper's contract. The runtime trap remains defense in depth,
not the intended discovery mechanism. Apps unable to meet this contract stay on
the unsplit build until they supply an enumerable boundary.

### Shared cost and budgets

Server groups each contain the shell runtime and needed libraries. No remote
shared server chunk and no cross-unit package singleton: each isolate has its own
registry and cache. Preserve shared package identity *within* a group, including
linked modules, through the existing provider ABI. Report final uncompressed
UTF-8 unit bytes, compressed/package bytes where relevant, source-attributed
module contributions, linked input/factory bytes, and repeated dependency bytes
across groups. Attribution is diagnostic; final emitted bytes enforce budgets.
Show startup measurements separately; size is only a proxy for cold start.

The default edge safety budget is 9,000,000 bytes below an approximate 10 MB limit;
the deployment tool supplies the actual account/runtime limit and measurement
basis. Fail on either configured or target limits, including wrappers, linked
factories and any optional fallback router. For function packages report the full archive and unpacked
inventory, not just the handler. No silent budget escalation or gzip substitution
for a runtime measuring source bytes. Reject an export lacking a target budget.

## 3. Build graph, output and seal

Build the full client once, then each server group with an isolated compiler cache
key containing target, group, membership, snapshot and runtime projection. Never
reuse the unsplit `index.ssr.js` as input to every group: exclusion must happen
before server bundling. Generate a group SSR entry importing the shared wrapper,
selected registry, group context and subset link module, then the target shim.
Edge units must be single-file, with no unresolved local chunks or filesystem
resolution. Function units may be packages, but every packaged file is inventoried.

Keep one browser bootstrap, one runtime and one shared vendor graph per release.
Preserve current deterministic IDs and shared vendor splitting in
`src/utils/rspack.ts`; the generated page registry uses literal dynamic imports
so pages become async chunks. Static imports in user code stay eager and appear
in the size report. Shared client dependencies are factored by the bundler across
all page chunks, never independently compiled per server group. User optimization
settings must not create a second UI runtime or omit a reachable chunk.

Every group's HTML uses the same bootstrap/client graph ID. Its preload set
contains bootstrap dependencies and the selected page's transitive JS/CSS assets,
not all pages. Loading a page from another group is a browser dynamic import from
that same graph; it does not reload the document or replace shared providers.
Server-data requests still target the page's public URL with `Accept:
application/json` and the browser release selector. Native rules select a group;
the unit gates the selector before any app work. The current data-only contract
returns `serverData`,
not arbitrary new initial props: app routers needing additional navigation props
must explicitly fetch them or adopt a separately versioned data contract.

Put assets beneath an immutable release asset prefix, e.g.
`/_releases/<releaseId>/assets/`, with content-hashed filenames. Use the existing
runtime public-path initialization before bootstrap execution for all lazy JS,
CSS, fonts and preload URLs. The asset-base override must preserve this prefix
and serve the exact inventory; it changes location, never bytes or identity.
Pinned client files keep their build-ID directory structure. Publish complete
client trees, including internally loaded chunks. Do not promise SRI on internal
chunks where the existing loader provides SRI only for entry JS/CSS.

Hydration must use the same wrapper, route parameters, selected page, serialized
props, normalized query data, public configuration and pinned client descriptors
as SSR. Run `getClientProps` and load/register required composed clients before
hydration. Switching server groups must not change client module IDs or the
shared-provider ABI. A mismatch of embedded release/client graph IDs aborts
hydration and requests a fresh document; it cannot silently hydrate another graph.

Validate the entire pinned snapshot once using existing identity, file, flavour,
contract and version checks. For each group, union its pages' declared module uses
and explicit group uses (including common lifecycle needs); link only non-client-only
members using verified snapshot bytes. Preserve per-module provenance and lazy
registration before `getInitProps`. Dynamic `getModule(name)` requires an explicit
finite set; missing declarations fail analysis/tests. There is one build ID per
module name across the release, even when used by several groups. Include all
modules' public client descriptors/assets in the shared client inventory so client
navigation can discover modules outside the first server group's subset; never
serialize server directories. A prebuilt module's server entry is indivisible:
we can omit the whole factory, not reliably remove individual exposed namespaces.
Validate library pins too; do not newly auto-execute them.

Proposed self-contained export root (not a public web root):

```text
split-output/
  split-manifest.json
  composition-provenance.json
  routing-plan.json
  units/main/entry.mjs
  units/account/entry.mjs
  static/assets/...
  static/_builds/<buildId>/client/...
  static/out.html
```

Only explicitly publishable static files are served. Templates, optional fallback
router source, server units and metadata are never exposed by directory fallback. Logical public
mounts are in the manifest; deploy preserves their release-qualified mapping.
All manifest paths are relative to this root, slash-separated, nonempty, without
absolute paths, `..`, empty segments, backslashes, symlinks or special files.
Diagnostic source paths stay in a separate local report, outside the release.

The manifest has a strict schema with unknown required versions rejected. Types
below specify the complete minimum contract; hashes are lowercase 64-digit hex,
sizes nonnegative safe integers, sets sorted and unique. Group order is name order;
matching follows grammar precedence; the routing plan serializes that order.

```ts
type FileRecord = { path: string; sha256: string; size: number };
type SplitManifest = {
  version: 1;
  releaseId: string;
  target: 'edge-script' | 'bound-worker' | 'function';
  runtimeContract: 'split-1';
  clientGraphId: string;
  snapshot: null | { id: string; sha256: string };
  groups: Array<{
    name: string;
    patterns: string[];
    pages: string[];                     // public IDs, never source filenames
    linkedModules: Array<{ name: string; buildId: string }>;
    files: FileRecord[];                // all files of this immutable unit
    entry: string;                      // must occur in files
    serverBytes: number;
    budgetBytes: number;
  }>;
  defaultGroup: string;
  routes: Array<{ pattern: string; page: string }>;
  notFoundPage: string;
  client: { files: string[]; assetPrefix: string }; // inventory path references
  static: {
    directory: 'static'; files: FileRecord[]; sha256: string;
    mounts: Array<{ path: string; file: string; cache: 'immutable' | 'revalidate' }>;
  };
  routing: {
    grammar: 'path-1'; mode: 'native' | 'router-opt-in';
    plan: FileRecord; fallbackFiles: FileRecord[]; // empty by default
    releaseSelector: 'x-hadars-release';
  };
};
```

`client.files` references all browser bootstrap/chunk/style/resource paths in
`static.files`, including pinned client files. The static inventory additionally
includes templates; mounts exclude private templates. All version 2 file records
use export-root-relative paths, including records in the static inventory. Exact mounts win before app routing. Static inventory
digests retain the existing sorted `[path, sha256, size]` tuple algorithm.

Extend `finalizeExport` with an explicit split descriptor overload and
`verifyExport` with `output.version: 2`; keep version 1 verification unchanged.
Version 2 stores the manifest record, complete unit/optional-fallback/control
file inventory, static inventory, and their digests in the existing provenance structure. Create
provenance even without composition pins. Preserve snapshot/module provenance
fields and add per-group linking records. Finalize only after all bundles,
reports required for activation, and routing plans exist.

One `output.metadataSha256` seals canonical recursively key-sorted JSON with only
that checksum and reserved `output.signature` omitted, as today. It covers the
manifest file hash and every output inventory transitively. Exclude only the
provenance file itself from file inventories to avoid a cycle. The split manifest
contains neither its own hash nor the provenance hash. `verifyExport` rehashes
all bytes, rejects missing/extra files throughout the owned export root, checks
inventories agree, verifies all referenced entries, and checks pattern/membership
and composition consistency. It accepts an externally retained expected checksum;
an untrusted self-reported checksum is insufficient. Signing remains external.

Avoid a release-ID/hash cycle: assign a unique release ID before bundling (a
SHA-256 of canonical build-plan inputs plus a build nonce), then embed it in
units and routing plans. The final output seal identifies actual bytes. Publishing
the same release ID with a different seal is forbidden. Reproducible builds may
supply the same nonce and inputs; a byte difference still prevents reuse.

## 4. Routing plan contract and native mechanisms

Hadars emits versioned, declarative `routing-plan.json`, not routing code, account
IDs, secrets or live hostnames. The deployment tool translates it into native
CDN rules, routes, bindings where appropriate, or cache behaviours. It resolves
logical unit references without editing sealed output. No phase depends on a
generated router. Minimum plan schema (JSON serialization of these types):

```ts
type RoutingPlan = {
  version: 1;
  releaseId: string;
  runtimeContract: 'split-1';
  grammar: 'path-1';
  defaultGroup: string;
  groups: Array<{ name: string; unit: string }>; // manifest group entry references
  rules: Array<{ order: number; pattern: string; group: string }>;
  staticMounts: Array<{ path: string; file: string }>;
  releaseSelector: 'x-hadars-release';
  probe: { header: 'x-hadars-release-probe'; protocol: 'split-probe-1' };
};
```

Groups are unique and name-sorted; default/rule groups must exist. Unit and static
references must match sealed manifest inventory. Rules have contiguous zero-based
`order`, highest grammar precedence first; overlap ties fail as in section 2.
For disjoint equal-ranked patterns use lexical pattern then group order to make
serialization and update order deterministic. Array order is an encoding of
computed precedence, not user-defined precedence. Exact static inventory mounts
precede app rules. The receipt separately binds the plan digest to the final seal
(to avoid a hash cycle), resolved immutable revisions and translated rule IDs.
Unknown versions, missing/extra groups or mutable destinations fail verification.

Translation MUST preserve the whole language, default selection, normalization
and precedence of `path-1`, including negatives and boundary cases. Expand a rule
into adjacent ordered native rules only when the expansion is exactly equivalent;
record each expansion and witness in the translation receipt. Count expanded
rules, static mounts and defaults against fixed provider/account limits before
creating resources. Reject unsupported patterns with a witness and diagnostic;
never broaden `/admin/**` to `/admin*`, which also matches `/administrator`.
A wildcard that spans slashes cannot represent a one-segment `:id` by itself.
If a provider cannot express that constraint, normalization, case sensitivity or
zero-segment rest semantics exactly, reject the affected grammar subset for that
translator. An unexpressible plan cannot silently opt into a router.

Conformance tests compare each translator's local model of native rules with the
**same local reference matcher** used by hadars dev, analysis and client selection.
Use exhaustive bounded segment cases plus generated witnesses/counterexamples:
root, exact/prefix boundaries, parameters, empty/rest paths, overlapping rules,
trailing/repeated slashes, escapes, case, query strings, all methods and static
mounts. Test every intermediate update/undo map and release mismatch before any
hook. A reference matcher/proxy simulates routing only in tests/dev; it is never
production ingress. Native semantics unconfirmed by fixtures need provider-doc
verification and eventual public-host probes before enabling a translator.

Common verification stages direct unit probes, then public-host probes for each
group and each translated rule boundary/precedence witness. Reserved probes
return embedded release/group/client graph IDs and linked build IDs, require
deployment authentication, bypass cache and perform no app hooks. Read back all
rules/defaults and code digests where available; health alone does not establish
artifact integrity. Authentication and public Host/scheme/client-IP semantics
must be native or unit-adapter capabilities, not a prerequisite routing function.
Strip client-supplied internal group/forwarding claims; derive group/release from
embedded constants and trusted native metadata. Public release selectors remain
untrusted consistency assertions. Protect private origins with native access
controls or signed origin requests; reject unauthorized direct calls with 403.
Native destination context inconsistent with embedded IDs is a no-store
`503 SPLIT_RELEASE_MISMATCH` before hooks; browser selector mismatches use 409.
If the provider cannot supply the required trust boundary, reject deployment.

Group response caches are keyed by release, group, runtime config revision,
method, canonical URL, representation and app cache key, with auth/cookie variation
controlled by the app. Shared native caches must validate the selector before
lookup and isolate releases or be disabled for HTML/data. Mismatch/error/probe
responses are no-store; immutable assets use release-qualified keys. Native
adapters must preserve original public URL/Host, method, query/body, redirects,
multiple cookies, cancellation and supported streams. Reject unsupported upgrades
with 501 before app hooks. Routing must never replay mutations or follow redirects
internally. These are conformance requirements, not assumed provider features.

All provider details below other than the supplied CDN measurements are
**to verify against provider docs before implementation**. They describe proposed
translator contracts, not capabilities established by this repository.

### Edge-script CDN: native rules and a default script

Measured on **an edge-script CDN**, one provider on one day: a public zone used
one edge script as its default origin and carried edge rules. A URL-pattern
condition with action **"run edge script"** selected a different standalone
script directly. With `https://*/admin*` and `https://*/dashboard*`, matching paths
used the rule's script and other paths used the default. The selected script saw
the original public Host header. Measured warm latency was 52–98 ms across all
routes, indistinguishable from the default route in this sample: no extra hop
and no router. These samples do not establish latency bounds or exact `path-1`
translation. Action **"change origin URL"** was ignored when the zone origin was
an edge script; only "run edge script" worked for the tested script-to-script
path routing. Do not translate this plan using origin-URL changes.

The tool creates immutable standalone scripts for all groups, native ordered
"run edge script" rules and the zone's default-script pointer, plus asset/cache
configuration. Hadars emits the plan above and group script references. The
translator must verify rule ordering/precedence and wildcard semantics. Candidate
expansion of `/admin/**` is exact `/admin` plus `/admin/*`, subject to documented
trailing slash, query, host and wildcard behaviour; the measured `/admin*` test
is not proof of that expansion. Reject `:name` and any other subset that native
conditions cannot express exactly. Verify fixed rule count limits, including
expansion, other zone rules and reserved static mounts, before implementation.

Measured rule updates require one API call per rule, with no bulk call. Use the
fixed ordered edit script and default-last protocol in section 1, public-host
probes and complete readback; reverse receipt steps for rollback. The single-run
propagation measurements there must be repeated, including sync-boundary cases.
Earlier measurements showed a single default-pointer field change and cache
purge becoming visible in about 3–5 s. Cache purges are neither activation nor a
transaction barrier. This zone's cache ignored query strings by default unless
configured: query-only release/probe selectors cannot establish isolation.
Disable shared HTML/data/probe caching unless release-aware keys and selector
validation before cache lookup are assured; immutable assets use release paths.

### Cloudflare: native Workers Routes

**To verify against provider docs before implementation:** Workers Routes patterns
can select separate group workers directly. The tool creates release-specific
workers with frozen versions/deployments, native route entries in the zone, a
default/catch-all mapping and static/cache policy. Hadars emits the same ordered
plan with worker unit references. Translate to Workers Routes patterns only with
proven equivalence, including provider specificity, overlap ordering, wildcard
slash behaviour and exclusions; verify route/worker/account limits. Reject
unrepresentable `path-1` subsets rather than relying on a dispatch worker.

**To verify against provider docs before implementation:** route changes are
per-route API calls; worker versions/deployments do not make multiple route
writes one transaction. Freeze each release-specific worker deployment; never
shift individual worker versions under a retained plan. Use section 1's ordered
route updates and default-last mapping, record provider revision/route IDs,
read back every route and worker deployment, and probe via the public hostname.
Rollback reverses receipt steps to the previous routes/deployments and verifies
public probes. Native propagation may serve different complete releases on
different paths; release gating is required.

Service bindings are for worker-to-worker calls, which splitting should not need;
they are not the default dispatch mechanism. Binding permissions, version pinning,
origin protection and native request metadata are **to verify against provider
docs before implementation** if an application independently needs such calls.

### AWS: CloudFront cache behaviours and function URL origins

**To verify against provider docs before implementation:** the tool publishes
immutable group function packages/versions and separate function URL origins
pinned to frozen release units, with origin authentication, static origins and
one distribution configuration containing **all** ordered cache behaviours and
the default behaviour. Hadars emits the routing plan with group package references;
the translator expands patterns only if CloudFront semantics match `path-1`
exactly, validating precedence, normalization, cache policies and behaviour/origin
limits. Confirm which function URL qualifier forms are supported; if only aliases
are usable, use release-specific aliases frozen until retirement, not `latest`.

**To verify against provider docs before implementation:** one conditional
distribution configuration update replaces **all** behaviours in one API call.
This is the strongest atomic story among these native candidates: each old/new
configuration contains a complete map, unlike sequential per-route updates.
Confirm per-request coherent config selection and cache isolation; distributed
propagation still allows old/new configurations to coexist. The tool records the
old/new full config, version token and unit revisions, reads back every behaviour
and default, waits for deployment and verifies public-host group probes. Rollback
conditionally restores the prior full config in one call and repeats verification;
record ambiguous timeouts and reconcile instead of blindly overwriting changes.

**To verify against provider docs before implementation:** an API Gateway
alternative creates a complete staged API deployment integrating immutable group
functions and switches one stage deployment reference where the selected gateway
type supports that model. Verify path grammar, stage-switch semantics, limits,
authentication, cache behaviour and full-config rollback for that gateway type.
Function URLs alone do not route public paths. Neither native option needs a
router function. The existing function adapter buffers gateway v1/v2 events;
function URL event parity, public Host, cookies, binary bodies, repeated query
parameters, env/asset-base parity and streaming require adapter conformance work.
Do not infer streaming/upgrade support merely from the origin transport.

### Explicit opt-in fallback, outside the critical path

Only for a provider without native path routing, an owner may explicitly request
a generated router. It consumes the same verified plan, freezes a complete map
of immutable units and activates through one router revision pointer. It costs
an extra invocation/hop, failure point and code in the request path. No native
translator failure automatically enables it; unsupported plans fail clearly.
Future fallback work must specify authenticated origin transport, original URL
preservation, one-hop loop prevention, no mutation replay, manual redirects,
stream cancellation, cookie/header fidelity, cache isolation, size/subrequest
budgets and complete-map rollback. It is optional and no earlier phase depends
on it. It is separate from the native hidden-zone strict-atomic trade-off.

## 5. Runtime semantics

All dynamic requests enter one selected group. Authenticate release context first,
then apply that group's runtime config, `fetch`, proxy, cache and render lifecycle.
Run the shared entry's `getInitProps` once per request in that group, then the
normal render/finalize sequence. Group-specific initialization can branch on a proposed trusted `req.split = { releaseId, group }`. Common hooks
that need composed modules declare them in every affected group's membership.
Do not initialize other groups or perform hidden internal page requests.

Cookies and authorization headers pass through without rewriting session content.
Use a common external session store or compatible signed tokens, keys and cookie
Domain/Path/SameSite settings across groups. In-memory sessions, global module
state, query caches and connection pools **do not cross groups**. Each request's
`useServerData` cache remains shared within that render/preflight/finalize only;
it serializes fulfilled values as today. A normalized GraphQL query cache belongs
to that request's initialization and is dehydrated by `getFinalProps`, restored
by `getClientProps`; other groups do not see its server memory. Browser caches
survive client navigation but require auth-aware keys and invalidation. External
schema/API compatibility during rollback is an app responsibility.

Runtime environment and secrets are provisioned per unit by the deployment tool.
A sealed output references required environment *names*, never secret values;
keep that optional schema in a covered control file. Record the runtime config
revision in the deployment receipt. Treat changes of public values, asset base,
session signing policy or behavior-affecting bindings as a new release activation,
not independent mutable edits of running units. Group-private connection limits
may differ, but browser-visible values and asset mapping must agree across groups
unless explicitly namespaced and covered by hydration tests.

Retain `HADARS_PUBLIC_*` opt-in publication, escaped JSON, per-binding isolation
and the 32 KiB payload limit described in the runtime configuration document.
Retain `HADARS_ASSET_BASE_URL` validation and chunk-path initialization; the same
release asset tree must be reachable from every group. Root-relative pinned
client paths relocate under that base; independently configured absolute module
origins retain their existing behavior. Function split adapters must first gain
parity for public environment, asset-base overrides and pinned client descriptors;
the current bundled function path lacks the edge adapters' full integration.

Server redirects between groups are normal public HTTP redirects. Return them
to the client; no server-side re-dispatch or second `getInitProps` inside one
request. The next request resolves under browser release policy. Redirects,
fetch/proxy responses, cached responses and render errors pass through a common
`onResponse` wrapper once in the selected group. Native routing/probe metrics are
separate from app hooks. The edge-script adapter already wraps responses;
other split adapters need lifecycle parity instead of assuming it exists today.
`onError` records the selected release/group and preserves the current contract.
Errors after streaming begins close the stream; hooks cannot replace an already
sent status/body. The existing renderer produces body HTML before transport
streaming in single-pass mode; this RFC does not promise incremental component
rendering merely because a native transport preserves a `ReadableStream`.

Static mounts precede group matching by exact inventory lookup, not extension
heuristics. Generated assets and pinned client trees are immutable. Root
`robots.txt`, sitemap and user static files belong to the release-wide static
inventory, with public stable URLs using release-selected origin/cache policy and
revalidation, or explicit shared-content invariance. Missing asset paths return
static 404 without SSR. Unknown app paths render the common not-found page in the
selected group. A missing group deployment is 503, never a page 404. Static HTML
must use the same release/client graph; mutable root HTML caches are disallowed.

Add instrumentation equivalent to `x-hadars-subrequests`: application upstream
count and trustworthy total, labelled by release/group. Strip client counters.
Native direct routing adds zero router invocations; an explicitly enabled fallback
counts its hop once. Exclude browser asset fetches from server request totals.
Provider-native counts are separate measurements; report `unknown` when total
app fetches cannot be instrumented. Work after headers is recorded in logs/metrics
or supported trailers. Emit `split_dispatch_total`, `split_dispatch_error_total`,
per-group duration/size, `split_membership_error_total` and release mismatch
metrics. Redact credentials, cookies and raw sensitive query strings.

## 6. Development and diagnostics

`hadars dev` still serves all groups through one public port and one process,
with one browser HMR graph. Show selected group and resolved page in diagnostics;
load all pages by default for quick edits. Never imply that this default mode
proves bundle isolation. Proposed `hadars dev --simulate-split` compiles isolated
group graphs with the real replacement plugin, isolated module registries/caches
and a local reference matcher/proxy used only in tests/dev. Single-process mode
can use separate VM contexts; if the runtime cannot isolate globals reliably, use child processes behind the same
public port. CI's multi-process harness is the reference for isolation behavior.
Membership changes rebuild affected graphs and invalidate route tests.

`hadars export <target> --split [output-directory]` validates the plan, compiles
one client and all groups, enforces budgets, runs membership checks, generates
the declarative routing plan and seals the completed root. It exits nonzero
without a deployable seal on any failure. Unsplit CLI behavior stays compatible;
`--split` is invalid for static-only export in the first release. Export does not
contact infrastructure, upload artifacts, create resources or activate a pointer.

Proposed `hadars split report --target <target> [--json]` performs the same planned
build without deployment, reports paths/pages/module IDs, final sizes, duplication,
budget headroom and representative route witnesses. Exact final sizes require
compilation; do not present import estimates as upload sizes. A `--check` mode
fails on budget or membership violations and is suitable for local CI.

Diagnostics include a stable code, affected group/path and an actionable change:

```text
SPLIT_PATTERN_AMBIGUOUS: /a/:id overlaps /a/:name; witness /a/x.
SPLIT_PAGE_UNAVAILABLE: account /account/42 needs page details via account -> details;
  add details to account.pages or move the shared export out of that page.
SPLIT_OPAQUE_LOADER: page loader has a computed path; enumerate page IDs in split.pages.
SPLIT_MODULE_UNDECLARED: account uses identity; declare it on the page or group.
SPLIT_SIZE_EXCEEDED: account 9200001 bytes > budget 9000000; largest inputs follow.
SPLIT_RELEASE_MISMATCH: account expected <release>, received <other>; no fallback.
SPLIT_ACTIVATION_UNSUPPORTED: provider cannot express /account/:id exactly;
  revise the plan or select a capable native target; no automatic router fallback.
```

## 7. Security and integrity boundary

`verifyExport(root, metadataPath, trustedChecksum)` is mandatory before resource
creation/upload and again on any copied/staged export. Validate the split schema,
strict path rules, full inventories, target size basis, client graph closure,
module compatibility, route coverage and seal before translating the routing plan.
Reject traversal, symlinks, duplicate JSON keys, unsafe mounts, duplicate file
records and unknown required protocol versions. The deployment tool establishes
trust in the checksum through its own authorized artifact channel; recomputing a
self-reported checksum is not authentication.

Resolved destination addresses come only from deployment-owned resources. Permit
HTTPS origins with no credentials, path, query or fragment, or enumerated private
bindings/qualified invocation IDs. Pin resource identity and validate resolved
addresses against deployment policy; do not permit arbitrary private/metadata
network addresses through an HTTP target, user-supplied hostname overrides or
redirect-based origin changes. Private local-test addresses require an explicit
simulation mode unavailable in production. Fixed tables plus authenticated origin
transport prevent SSRF and release/header spoofing. The public browser selector
asserts release identity (or selects a retained release where native affinity is
supported), never a group, path rewrite or URL.

Preserve the current build-time/runtime config projection and client server-data
callback stripping. Splitting must not copy server modules, config secrets,
local paths or source maps into public static output. Group bundles receive no
additional secret values merely because they share a shell; deployment secrets
remain runtime inputs with the same access semantics as a single bundle. Public
runtime names intentionally expose their values. Group isolation is not a sandbox
against malicious app code or a replacement for composition artifact trust.

## 8. Phased implementation and local acceptance gates

Every phase is opt-in and leaves existing unsplit output unchanged. Local tests
use fixtures, fake deployment receipts and loopback processes; no network or
provider account is required. Native provider guarantees remain deployment-tool
capability assertions, with readback/probes required before real activation.

| Phase | Shippable artifact and deployment-tool interface | Tests and risks |
| --- | --- | --- |
| 1. Plan and report | Config schema, matcher, route/page registry and membership analyzer; report command builds candidate group graphs for exact sizes but keeps deployment unsplit. Tool may consume report JSON only; it must not activate candidate units. | Unit tests for precedence, language intersection/witnesses, canonical paths, aliases/re-exports, static and literal lazy imports, computed-loader rejection; size thresholds at boundary ±1 byte; local unsplit fixture parity. Risk: arbitrary app routers require migration; strict errors must explain it. |
| 2. Group output and integrity | Per-group SSR entries, stubs, shared client graph, output manifest and seal v2; tool can verify/stage an export but production split activation stays disabled until dispatch support. Reject composition-enabled split export pending phase 5. | Unit graph/manifest tests; local multi-process native-routing simulation across two releases; HTML/JSON hydration and cross-group navigation with lazy CSS; body/cookie/redirect tests; tampered/missing/extra files, metadata, route edits and untrusted seal tests; final-size failures. Risk: eager exports, global state and plugin ordering defeat pruning unless checked in final graph. |
| 3. Routing plan emission + plan verification + local simulation of native routing | Versioned plan JSON, reference matcher/proxy used only in tests/dev, group release gating and receipt/readback/probe schemas. Tool can validate a plan and rehearse ordered activation/undo; production translators follow in phase 4. | Local multi-process old/new units; selector mismatch before any hook/cache, bounded document reload, mutation never replayed, expired tab, precedence/normalization witnesses, mixed-path propagation, intermediate membership changes, failed/ambiguous calls, reverse idempotent rollback and conflicting writers. Risk: simulation cannot establish provider propagation bounds. |
| 4. Provider plan translators | Native edge rules, worker routes and distribution behaviours/gateway plans; tool creates frozen units, translates and checks limits, records receipts, applies updates and verifies public-host probes. No routing script/function. Optional hidden-zone strict mode requires an explicit capability check. | Translator/reference-matcher conformance, unsupported subset rejection, expanded limits, complete readback, public-host probe mocks, default-last and reverse rollback, one-call full config restoration, cache isolation, event/header/cookie/binary conversion, env/asset-base parity, stream/upgrade capability checks. Risk: provider details must be verified against docs before implementation; propagation requires repeated measurement. |
| 5. Composition subsets | Validated snapshot shared across groups; subset factories, public client union, group provenance and seal integration. Tool verifies linked build IDs on every unit against the single sealed snapshot; it never resolves new pins at activation. | Unit dependency-set and client-only tests; e2e two pages using different pins plus one shared provider; same module ID in multiple groups, lazy evaluation before/after getInitProps, cross-group browser module loading, unsupported external rejection, snapshot/file tamper, undeclared dynamic lookup and linked-byte budget tests. Risk: coarse prebuilt module entries and shared provider initialization keep bundles large. |
| 6. Optional router fallback | Explicit opt-in only for a provider without native path routing; consumes the same plan and uses one frozen router map/revision. No phase 1–5 dependency. | Transport/auth/loop/stream/cookie/cache conformance, failure and whole-map rollback, hop/subrequest/size budgets; extra invocation and failure surface require explicit owner acceptance. |

Each phase's tests must pass locally before its flag is enabled. The simulation
harness uses a stable ingress, separate group processes and immutable per-release
plans; deliberately kill/replace a group and propagate native rules independently
during traffic. Assert every request executes within one complete release or fails
before hooks, even while different paths return different releases. Include
not-found, error and auth branches, multiple concurrent renders, static assets and old/new browser
data requests. Test a rollback while a stream is open: that stream retains its
original release. No success criterion relies solely on happy-path health checks.

The common deployment-tool interface is:

1. Consume the root, expected seal, target capability policy and external runtime
   configuration references. Verify; reject unsupported target behavior.
2. Create immutable units/assets and resolve/translate the routing plan. Produce
   a receipt binding the seal, plan, all identities, config revisions and hashes.
3. Probe the staged whole release; validate grammar equivalence, every intermediate
   ownership map, capacity limits, auth and cache policy. Mark ready only when
   every unit and mapping passes. Snapshot the previous native configuration.
4. Apply section 1's receipt-recorded ordered native writes and default-last flip,
   or a verified complete-map update/optional strict-mode single field flip.
   Read back every rule/default and probe all groups through the public hostname;
   observe release metrics. Failure undoes recorded steps in reverse order (or
   restores the previous full config), with readback and probes after rollback.
5. Retain old groups, native configs/hidden zones and assets until streams, browser
   retention and rollback windows expire. Garbage-collect by whole-release
   reachability; preserve shared pinned assets referenced by any retained release.

Hadars implements artifact/schema/verification helpers and probes, not provider
API calls. Tools must declare whether activation uses sequential native updates,
a coherent full-map update or optional strict mode; never describe sequential
rules as an atomic whole-map switch. Router fallback requires explicit opt-in.

## 9. Owner decisions still needed

| Question | Recommendation | Consequence |
| --- | --- | --- |
| Is a short per-request mixed-release window acceptable during rule propagation (with release gating) or is strict atomic mode required? | Accept cross-path old/new release overlap with mandatory per-request release gating and one browser document reload. Require strict mode only for owners who need a complete-map selector. | Different requests may reach different complete releases; no single request executes a mixed tuple. The measured about 0.2 s window needs repeated measurement. Strict hidden-zone mode adds a hop and still propagates geographically. |
| Can split-owned pages adopt a declarative registry/outlet? | Yes; require it for strict split mode, with explicit additions for dynamic dependencies. | Verifiable membership; existing arbitrary routers remain supported in unsplit mode. |
| How long must old tabs and rollback work? | Initially retain complete releases for 24 hours and at least the previous two releases; make longer windows configurable. Direct native routing reloads old tabs on mismatch unless native release affinity is available. | Storage cost is explicit; expired tabs reload, mutations are not replayed. |
| Should client output split by server group? | No; one client graph with page chunks and shared vendors. | Reliable client navigation and one hydration contract; shared bootstrap may remain large. |
| What size basis and headroom should be mandatory? | Uncompressed 9,000,000-byte edge budget plus adapter-specific package limits and a separate fallback budget only if explicitly enabled. | Fail before upload; actual provider/account limits remain external inputs. |
| Are upgrades required initially? | Start with HTTP, explicit rejection for unsupported upgrades. | No false tunnel guarantee; add transport conformance tests before enabling. |
| When may composition-enabled splitting activate? | Only after phase 5; earlier phases explicitly reject it. | Avoid shipping an apparently complete split that still links every pin or mixes snapshots. |
| Can public config mutate independently after activation? | Freeze behavior-affecting configuration by receipt/release and activate a complete revision. | Prevent hydration/cache divergence despite immutable code; operational tuning needs a defined safe policy. |
