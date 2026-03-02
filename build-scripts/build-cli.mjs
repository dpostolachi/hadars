#!/usr/bin/env node
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'fs';
import { resolve } from 'path';

// Helper to mark package dependencies as external so native .node bindings are not bundled
function computeExternals(root) {
  try {
    const p = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const deps = Object.keys(p.dependencies || {})
    const opt = Object.keys(p.optionalDependencies || {})
    const peer = Object.keys(p.peerDependencies || {})
    const all = Array.from(new Set([...deps, ...opt, ...peer]))
    return all
  } catch (e) {
    return []
  }
}

const root = process.cwd();

async function run() {
  const externals = computeExternals(root);
  const distDir = resolve(root, 'dist');
  const distUtilsDir = resolve(distDir, 'utils');

  // Build CLI entry point
  const cliSrc = resolve(root, 'cli.ts');
  const cliOut = resolve(distDir, 'cli.js');

  await build({
    entryPoints: [cliSrc],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node18'],
    outfile: cliOut,
    sourcemap: false,
    external: externals,
  });

  // Ensure shebang is present on the CLI binary
  const shebang = '#!/usr/bin/env node\n';
  const cliContent = readFileSync(cliOut, 'utf8');
  if (!cliContent.startsWith('#!')) {
    writeFileSync(cliOut, shebang + cliContent, 'utf8');
  }
  console.log('Built', cliOut);

  // Build SSR watch worker — needed for Node.js/Deno where .ts cannot be
  // run directly. Bun prefers the .ts source but falls back to this .js.
  const ssrWatchSrc = resolve(root, 'src', 'ssr-watch.ts');
  const ssrWatchOut = resolve(distDir, 'ssr-watch.js');

  await build({
    entryPoints: [ssrWatchSrc],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node18'],
    outfile: ssrWatchOut,
    sourcemap: false,
    external: externals,
  });
  console.log('Built', ssrWatchOut);

  // Build SSR render worker — thread pool for renderToString on Bun/Deno.
  const ssrRenderWorkerSrc = resolve(root, 'src', 'ssr-render-worker.ts');
  const ssrRenderWorkerOut = resolve(distDir, 'ssr-render-worker.js');

  await build({
    entryPoints: [ssrRenderWorkerSrc],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node18'],
    outfile: ssrRenderWorkerOut,
    sourcemap: false,
    external: externals,
  });
  console.log('Built', ssrRenderWorkerOut);

  // Build rspack loader as CJS so rspack/webpack can require() it at runtime.
  // The source is TypeScript; esbuild strips types and outputs plain JS.
  const loaderSrc = resolve(root, 'src', 'utils', 'loader.ts');
  // Use .cjs extension so Node.js treats it as CommonJS even when the package
  // has "type": "module". Rspack/webpack loaders are loaded via require().
  const loaderOut = resolve(distDir, 'loader.cjs');

  await build({
    entryPoints: [loaderSrc],
    bundle: false,
    platform: 'node',
    format: 'cjs',
    target: ['node18'],
    outfile: loaderOut,
    sourcemap: false,
  });
  console.log('Built', loaderOut);

  // Copy runtime assets that are read as files at runtime (not bundled into cli.js).
  // When cli.js runs, import.meta.url points to dist/cli.js, so packageDir = dist/.
  // These files must mirror the paths resolved from there.
  mkdirSync(distUtilsDir, { recursive: true });

  // dist/utils/clientScript.tsx — rspack entry template used by dev() and build()
  cpSync(
    resolve(root, 'src', 'utils', 'clientScript.tsx'),
    resolve(distUtilsDir, 'clientScript.tsx'),
  );
  console.log('Copied dist/utils/clientScript.tsx');

  // dist/utils/Head.tsx — imported by the generated client script at runtime via
  // an absolute path (the $_HEAD_PATH$ placeholder). Rspack resolves .tsx extensions,
  // so the raw source file is sufficient — no pre-compilation needed.
  cpSync(
    resolve(root, 'src', 'utils', 'Head.tsx'),
    resolve(distUtilsDir, 'Head.tsx'),
  );
  console.log('Copied dist/utils/Head.tsx');

  // dist/template.html — HtmlRspackPlugin template (resolved from packageDir in rspack.ts)
  cpSync(
    resolve(root, 'src', 'utils', 'template.html'),
    resolve(distDir, 'template.html'),
  );
  console.log('Copied dist/template.html');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
