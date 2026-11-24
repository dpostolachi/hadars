# Split export validation

The routing and budget decisions are implemented. The published v1 contract is
[split-export-contract.md](split-export-contract.md); the earlier nested-mount
routing contradiction is resolved by rejecting equal or segment-wise nested
literal prefixes across different groups. Same-group overlaps remain valid.
No deployment or push was performed.

## Validation on 2026-10-27

This run had local listener and network access enabled.

- `bun run build:all`: passed, including declarations and CLI builds.
- `bun test test/composition-split.test.ts test/composition-split.e2e.test.ts test/split-export-conformance.test.ts`:
  **34 passed, 0 failed, 19,540 assertions**, 2.62 seconds.
- Final full `bun test`: **416 passed, 0 failed, 20,482 assertions**,
  39 files, 19.94 seconds.
- The first full run had 414 passes and one failure: the known intermittent
  `test/hmr.e2e.test.ts:223` state-preservation assertion received false instead
  of true. The file immediately passed alone (4 tests, 13 assertions). A second
  full run passed all 415 tests then present. After the final policy-sealing
  regression test was added, the final full run passed all 416 tests. The first
  failure is retained here rather than hidden by the successful retries.
- The previous restricted-environment listener, fixture executable, browser-launch
  and bundler/subprocess failures did not recur. The previous 16 failures are
  gone in this run. The logged `error: expected` in the response-hook test is an
  intentional render-error fixture, not a test failure.
- The split integration test now starts real `run` and `dev` listeners. Both
  return the reserved probe before the configured application hook, report
  `dev-all`, send `Cache-Control: no-store`, and log `/admin/x -> admin` versus
  `/administrator -> main`. Each child is stopped and its temporary files removed.
- Full generated units execute in process and verify isolated module markers,
  probes, identity headers, final hashes/sizes and complete seal. Tamper checks
  cover edited/missing/extra/swapped units, manifest edits, static edits/removal/
  additions and metadata/trusted-checksum changes. Absent split and explicit
  single mode remain byte-identical to an independently bundled legacy shim.
- Default and configured manifest budgets are checked through the real CLI.
  Oversized export reports `SPLIT_SIZE_EXCEEDED`; manifest verification rejects
  missing, noninteger, nonpositive and unsafe budgets even after resealing.
  A valid resealed budget change preserves release identity but changes the seal;
  the original trusted checksum rejects it. A resealed undersized budget fails.
- Seeded property tests generate 120 prefix-free multi-mount sets and pathname
  witnesses/random paths, comparing manifest-order routing, longest-prefix
  routing and exact-plus-descendant native rule expansion.
- The tiny committed conformance export is generated through production export
  completion and sealing, with real pinned client provenance and the unit runtime.
  Unit sizes are 523, 521 and 521 bytes. Its test reads only committed files and
  checks every expected literal, plus mutation detection for every exported file.
- `bun scripts/gen-split-fixture.ts /tmp/split-vector` and
  `diff -r test/fixtures/split-export /tmp/split-vector`: passed byte-identically.
- `git diff --check`: passed. Forbidden-name and attribution scan of tracked
  additions and intended new source/documentation/fixture files: clean.

Representative full integration export: about 140–154 ms shared compilation and
52–58 ms group bundling/sealing; final sizes 110,956 bytes (admin), 110,953 (shop),
110,475 (main). These fixture timings are not production performance estimates.

## Local commit limitation

The repository identity is configured as `dpostolachi`. The worktree's `.git` is
a pointer to metadata in the separate protected checkout. That metadata is
outside the writable roots; this session forbids writing there and explicitly
forbids touching the separate checkout. No git metadata write or commit was
attempted, and no alternate metadata directory was used. All intended changes,
including the earlier split implementation, remain uncommitted in this worktree.

The changes can be committed in two logical groups when metadata is writable:
implementation/runtime/routing/budget changes with their tests, followed by the
published contract, generator, conformance vector/test and validation record.
Commit messages should contain only generic descriptions and no trailers.
