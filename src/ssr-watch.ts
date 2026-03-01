import pathMod from 'node:path';
import { compileEntry } from './utils/rspack';

// Simple worker to run an SSR watch in a separate process to avoid multiple
// rspack instances in the same process.

const args = process.argv.slice(2);
const argv: Record<string, string> = {};
for (const a of args) {
  if (!a.startsWith('--')) continue;
  const idx = a.indexOf('=');
  if (idx === -1) continue;
  const key = a.slice(2, idx);
  const val = a.slice(idx + 1);
  argv[key] = val;
}

const entry = argv['entry'];
const outDir = argv['outDir'] || '.hadars';
const outFile = argv['outFile'] || 'index.ssr.js';
const base = argv['base'] || '';

if (!entry) {
  console.error('ssr-watch: missing --entry argument');
  process.exit(1);
}

(async () => {
  try {
    console.log('ssr-watch: starting SSR watcher for', entry);
    await compileEntry(entry, {
      target: 'node',
      output: {
        iife: false,
        filename: outFile,
        path: pathMod.resolve(process.cwd(), outDir),
        publicPath: '',
        library: { type: 'module' }
      },
      base,
      mode: 'development',
      watch: true,
      onChange: () => {
        console.log('ssr-watch: SSR rebuilt');
      }
    } as any);
    // compileEntry with watch resolves after the initial build completes. Keep the
    // process alive so the watcher remains active, but first emit a clear marker
    // so the parent process can detect initial build completion.
    console.log('ssr-watch: initial-build-complete');
    await new Promise(() => { /* never resolve - keep worker alive */ });
  } catch (err) {
    console.error('ssr-watch: error', err);
    process.exit(1);
  }
})();
