#!/usr/bin/env node
import { runCli } from './cli-lib'

runCli(process.argv).catch((err) => {
  console.error(err)
  // When Bun runs a script, allow non-zero exit codes to propagate
  try {
    process.exit(1)
  } catch (_) {
    // Some Bun environments may not allow process.exit; just rethrow
    throw err
  }
})