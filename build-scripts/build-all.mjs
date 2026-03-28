#!/usr/bin/env node
/**
 * Runs build:lib (tsup) then build:cli (esbuild).
 * build:lib uses --clean which wipes dist/, so build:cli must run after.
 */
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

async function run(cmd) {
  const { stdout, stderr } = await execAsync(cmd, { shell: true });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

await run('npm run build:lib');
await run('npm run build:cli');
