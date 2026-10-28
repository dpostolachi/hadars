# Split conformance fixture

Units use the production minifier with legal comments and source maps disabled.
Regenerate from the repository root with `bun scripts/gen-split-fixture.ts`.
The generator pins production settings independently of the debugging environment.
Commit all generated files and expected literals together. Two runs must be byte-identical.
The platform's copied vector must be refreshed after any change to these bytes.

Each miniature unit renders its group inside a main element, probes its identity,
and embeds exactly one release global before entry scripts.
