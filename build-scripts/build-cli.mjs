#!/usr/bin/env bun
import { writeFileSync, mkdirSync, cpSync, readFileSync } from 'fs';
import { resolve } from 'path';

const root         = process.cwd();
const distDir      = resolve(root, 'dist');
const distUtilsDir = resolve(distDir, 'utils');

async function run() {
  // All four bundles are independent — run in parallel.
  // packages: 'external' treats all node_modules as external (no bundling of deps).
  const [cli, ssrWatch, ssrWorker, loader] = await Promise.all([
    Bun.build({
      entrypoints: [resolve(root, 'cli.ts')],
      outdir: distDir,
      target: 'node',
      format: 'esm',
      packages: 'external',
      naming: '[dir]/cli.[ext]',
    }),
    Bun.build({
      entrypoints: [resolve(root, 'src', 'ssr-watch.ts')],
      outdir: distDir,
      target: 'node',
      format: 'esm',
      packages: 'external',
      naming: '[dir]/ssr-watch.[ext]',
    }),
    Bun.build({
      entrypoints: [resolve(root, 'src', 'ssr-render-worker.ts')],
      outdir: distDir,
      target: 'node',
      format: 'esm',
      packages: 'external',
      naming: '[dir]/ssr-render-worker.[ext]',
    }),
    // Rspack loader must be CJS so rspack can require() it at runtime.
    Bun.build({
      entrypoints: [resolve(root, 'src', 'utils', 'loader.ts')],
      outdir: distDir,
      target: 'node',
      format: 'cjs',
      packages: 'external',
      naming: '[dir]/loader.cjs',
    }),
  ]);

  // Check for build errors
  for (const [result, name] of [[cli, 'cli'], [ssrWatch, 'ssr-watch'], [ssrWorker, 'ssr-render-worker'], [loader, 'loader']]) {
    if (!result.success) {
      console.error(`[build] ${name} failed:`);
      result.logs.forEach(l => console.error(l));
      process.exit(1);
    }
  }

  // Ensure shebang is present on the CLI binary.
  const cliOut     = resolve(distDir, 'cli.js');
  const cliContent = readFileSync(cliOut, 'utf8');
  const cliBody    = cliContent.startsWith('#!') ? cliContent.replace(/^#![^\n]*\n/, '') : cliContent;
  writeFileSync(cliOut, '#!/usr/bin/env node\n' + cliBody, 'utf8');

  console.log('Built', cliOut);
  console.log('Built', resolve(distDir, 'ssr-watch.js'));
  console.log('Built', resolve(distDir, 'ssr-render-worker.js'));
  console.log('Built', resolve(distDir, 'loader.cjs'));

  // Copy runtime assets read as files at runtime (not bundled into cli.js).
  mkdirSync(distUtilsDir, { recursive: true });
  cpSync(resolve(root, 'src', 'utils', 'clientScript.tsx'), resolve(distUtilsDir, 'clientScript.tsx'));
  cpSync(resolve(root, 'src', 'utils', 'Head.tsx'),         resolve(distUtilsDir, 'Head.tsx'));
  cpSync(resolve(root, 'src', 'utils', 'template.html'),    resolve(distDir, 'template.html'));
  console.log('Copied dist/utils/clientScript.tsx, dist/utils/Head.tsx, dist/template.html');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
