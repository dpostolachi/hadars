#!/usr/bin/env bash
# `hadars export bunny` always reads ./hadars.config.ts — there's no config-path
# flag. Swap in the bunny-specific config for the duration of the export, then
# always restore the real one, even on failure/interrupt.
set -euo pipefail

cd "$(dirname "$0")/.."

trap 'mv hadars.config.ts.orig hadars.config.ts' EXIT
cp hadars.config.ts hadars.config.ts.orig
cp hadars.bunny.config.ts hadars.config.ts

bunx hadars export bunny "$@"
