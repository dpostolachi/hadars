import { existsSync } from 'node:fs'
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as Hadars from './src/build'
import type { HadarsOptions, HadarsEntryModule } from './src/types/hadars'
import { renderStaticSite } from './src/static'
import { runSources } from './src/source/runner'
import { buildSchemaExecutor, buildSchemaSDL, introspectExecutorSDL } from './src/source/inference'

const SUPPORTED = ['hadars.config.js', 'hadars.config.mjs', 'hadars.config.cjs', 'hadars.config.ts']

function findConfig(cwd: string): string | null {
  for (const name of SUPPORTED) {
    const p = resolve(cwd, name)
    if (existsSync(p)) return p
  }
  return null
}

async function dev(config: HadarsOptions) {
    await Hadars.dev({
      ...config,
      baseURL: '',
      mode: 'development',
    });
}

async function build(config: HadarsOptions) {
    await Hadars.build({
      ...config,
      mode: 'production',
    });
}

async function run(config: HadarsOptions) {
    await Hadars.run({
      ...config,
      mode: 'production',
    });
}

async function loadConfig(configPath: string): Promise<HadarsOptions> {
  const url = `file://${configPath}`
  const mod = await import(url)
  return (mod && (mod.default ?? mod)) as HadarsOptions
}

// ── hadars export schema ─────────────────────────────────────────────────────

async function exportSchema(
    config: HadarsOptions,
    outputFile: string,
): Promise<void> {
    let sdl: string | null = null

    if (config.sources && config.sources.length > 0) {
        console.log(`Running ${config.sources.length} source plugin(s)...`)
        const store = await runSources(config.sources)
        console.log(`Schema inferred for types: ${store.getTypes().join(', ') || '(none)'}`)
        sdl = await buildSchemaSDL(store)
        if (!sdl) {
            console.error(
                'Error: `graphql` package not found.\n' +
                'Source plugins require graphql-js to be installed:\n\n' +
                '  npm install graphql\n',
            )
            process.exit(1)
        }
    } else if (config.graphql) {
        console.log('Introspecting custom GraphQL executor...')
        sdl = await introspectExecutorSDL(config.graphql)
        if (!sdl) {
            console.error(
                'Error: `graphql` package not found.\n' +
                'Schema export requires graphql-js to be installed:\n\n' +
                '  npm install graphql\n',
            )
            process.exit(1)
        }
    } else {
        console.error(
            'Error: no GraphQL source configured.\n' +
            'Add `sources` or a `graphql` executor to your hadars.config.ts first.\n',
        )
        process.exit(1)
    }

    await writeFile(outputFile, sdl, 'utf-8')
    console.log(`Schema written to ${outputFile}`)
    console.log(`\nNext steps — generate TypeScript types with graphql-codegen:`)
    console.log(`  npm install -D @graphql-codegen/cli @graphql-codegen/typescript @graphql-codegen/typescript-operations`)
    console.log(`  npx graphql-codegen --schema ${outputFile} --documents "src/**/*.tsx" --out src/gql/`)
}

// ── hadars export static ─────────────────────────────────────────────────────

async function exportStatic(
    config: HadarsOptions,
    outputDir: string,
    cwd: string,
): Promise<void> {
    if (!config.paths) {
        console.error(
            'Error: `paths` is not defined in your hadars config.\n' +
            'Add a `paths` function that returns the list of URLs to pre-render:\n\n' +
            '  paths: () => [\'/\', \'/about\', \'/contact\']\n',
        )
        process.exit(1)
    }

    console.log('Building hadars project...')
    await Hadars.build({ ...config, mode: 'production' })

    const ssrBundle = resolve(cwd, '.hadars', 'index.ssr.js')
    const outHtml   = resolve(cwd, '.hadars', 'static', 'out.html')
    const staticSrc = resolve(cwd, '.hadars', 'static')

    if (!existsSync(ssrBundle)) {
        console.error(`SSR bundle not found: ${ssrBundle}`)
        process.exit(1)
    }
    if (!existsSync(outHtml)) {
        console.error(`HTML template not found: ${outHtml}`)
        process.exit(1)
    }

    const ssrModule  = await import(pathToFileURL(ssrBundle).href) as HadarsEntryModule<any>
    const htmlSource = await readFile(outHtml, 'utf-8')
    const outDir     = resolve(cwd, outputDir)

    // Run source plugins (if any) and build an auto-generated GraphQL executor.
    // An explicit config.graphql always takes precedence over the inferred one.
    let graphql = config.graphql
    if (config.sources && config.sources.length > 0) {
        console.log(`Running ${config.sources.length} source plugin(s)...`)
        const store = await runSources(config.sources)
        if (!graphql) {
            const inferred = await buildSchemaExecutor(store)
            if (!inferred) {
                console.error(
                    'Error: `graphql` package not found.\n' +
                    'Source plugins require graphql-js to be installed:\n\n' +
                    '  npm install graphql\n',
                )
                process.exit(1)
            }
            graphql = inferred
            console.log(`Schema inferred for types: ${store.getTypes().join(', ') || '(none)'}`)
        }
    }

    const staticCtx = {
        graphql: graphql ?? (() => Promise.reject(
            new Error('[hadars] No graphql executor configured. Add a `graphql` function to your hadars.config.'),
        )),
    }

    const paths = await config.paths(staticCtx)

    console.log(`Pre-rendering ${paths.length} page(s)...`)

    const { rendered, errors } = await renderStaticSite({
        ssrModule,
        htmlSource,
        staticSrc,
        paths,
        outputDir: outDir,
        graphql,
    })

    for (const p of rendered) console.log(`  [200] ${p}`)
    for (const { path, error } of errors) console.error(`  [ERR] ${path}: ${error.message}`)

    console.log(`\nExported to ${outputDir}/`)
    if (errors.length > 0) console.log(`  ${errors.length} page(s) failed`)
    console.log(`\nServe locally:`)
    console.log(`  npx serve ${outputDir}`)
}

// ── hadars export cloudflare ─────────────────────────────────────────────────

async function bundleCloudflare(
    config: HadarsOptions,
    configPath: string,
    outputFile: string,
    cwd: string,
): Promise<void> {
    console.log('Building hadars project...')
    await Hadars.build({ ...config, mode: 'production' })

    const ssrBundle = resolve(cwd, '.hadars', 'index.ssr.js')
    const outHtml   = resolve(cwd, '.hadars', 'static', 'out.html')

    if (!existsSync(ssrBundle)) {
        console.error(`SSR bundle not found: ${ssrBundle}`)
        process.exit(1)
    }
    if (!existsSync(outHtml)) {
        console.error(`HTML template not found: ${outHtml}`)
        process.exit(1)
    }

    // Resolve cloudflare.js from the dist/ directory (sibling of cli.js).
    const cloudflareModule = resolve(dirname(fileURLToPath(import.meta.url)), 'cloudflare.js')
    const shimPath = join(cwd, `.hadars-cloudflare-shim-${Date.now()}.ts`)
    const shim = [
        `import * as ssrModule from ${JSON.stringify(ssrBundle)};`,
        `import outHtml from ${JSON.stringify(outHtml)};`,
        `import { createCloudflareHandler } from ${JSON.stringify(cloudflareModule)};`,
        `import config from ${JSON.stringify(configPath)};`,
        `export default createCloudflareHandler(config as any, { ssrModule: ssrModule as any, outHtml });`,
    ].join('\n') + '\n'
    await writeFile(shimPath, shim, 'utf-8')

    try {
        const { build: esbuild } = await import('esbuild')
        console.log(`Bundling Cloudflare Worker → ${outputFile}`)
        await esbuild({
            entryPoints: [shimPath],
            bundle: true,
            // 'browser' avoids Node.js built-in shims; CF Workers uses Web APIs.
            // If you use node:* APIs in your app code, add nodejs_compat to wrangler.toml.
            platform: 'browser',
            format: 'esm',
            target: ['es2022'],
            outfile: outputFile,
            sourcemap: false,
            loader: { '.html': 'text', '.tsx': 'tsx', '.ts': 'ts' },
            // @rspack/* is build-time only — never imported at Worker runtime.
            external: ['@rspack/*'],
            // Cloudflare Workers supports the Web Crypto API natively; suppress
            // esbuild's attempt to polyfill node:crypto.
            define: { 'global': 'globalThis' },
        })
        console.log(`Cloudflare Worker bundle written to ${outputFile}`)
        console.log(`\nDeploy instructions:`)
        console.log(`  1. Ensure wrangler.toml points to the output file:`)
        console.log(`       name = "my-app"`)
        console.log(`       main = "${outputFile}"`)
        console.log(`       compatibility_date = "2024-09-23"`)
        console.log(`       compatibility_flags = ["nodejs_compat"]`)
        console.log(`  2. Upload .hadars/static/ assets to R2 (or another CDN):`)
        console.log(`       wrangler r2 object put my-bucket/assets/ --file .hadars/static/ --recursive`)
        console.log(`  3. Add a route rule in wrangler.toml to send *.js / *.css to R2`)
        console.log(`     and all other requests to the Worker.`)
        console.log(`  4. Deploy: wrangler deploy`)
    } finally {
        await unlink(shimPath).catch(() => {})
    }
}

// ── hadars export lambda ────────────────────────────────────────────────────

async function bundleLambda(
    config: HadarsOptions,
    configPath: string,
    outputFile: string,
    cwd: string,
): Promise<void> {
    // 1. Ensure the hadars production build is up to date.
    console.log('Building hadars project...')
    await Hadars.build({ ...config, mode: 'production' })

    // 2. Resolve paths.
    const ssrBundle = resolve(cwd, '.hadars', 'index.ssr.js')
    const outHtml   = resolve(cwd, '.hadars', 'static', 'out.html')

    if (!existsSync(ssrBundle)) {
        console.error(`SSR bundle not found: ${ssrBundle}`)
        process.exit(1)
    }
    if (!existsSync(outHtml)) {
        console.error(`HTML template not found: ${outHtml}`)
        process.exit(1)
    }

    // 3. Write a temporary entry shim that statically imports the SSR module
    //    and the HTML template so esbuild can inline both.
    // Write the shim inside cwd so esbuild's module resolution finds local
    // node_modules when walking up from the shim's directory.
    // Use the absolute path to lambda.js (sibling of the CLI in dist/) so the
    // shim doesn't depend on package name resolution at all.
    const lambdaModule = resolve(dirname(fileURLToPath(import.meta.url)), 'lambda.js')
    const shimPath = join(cwd, `.hadars-lambda-shim-${Date.now()}.ts`)
    const shim = [
        `import * as ssrModule from ${JSON.stringify(ssrBundle)};`,
        `import outHtml from ${JSON.stringify(outHtml)};`,
        `import { createLambdaHandler } from ${JSON.stringify(lambdaModule)};`,
        `import config from ${JSON.stringify(configPath)};`,
        `export const handler = createLambdaHandler(config as any, { ssrModule: ssrModule as any, outHtml });`,
    ].join('\n') + '\n'
    await writeFile(shimPath, shim, 'utf-8')

    // 4. Bundle with esbuild.
    try {
        const { build: esbuild } = await import('esbuild')
        console.log(`Bundling Lambda handler → ${outputFile}`)
        await esbuild({
            entryPoints: [shimPath],
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: ['node20'],
            outfile: outputFile,
            sourcemap: false,
            loader: { '.html': 'text', '.tsx': 'tsx', '.ts': 'ts' },
            // @rspack/* contains native binaries and is build-time only —
            // it is never imported at Lambda runtime, so mark it external.
            // Everything else (React, hadars runtime, etc.) is bundled in to
            // produce a truly self-contained single-file deployment.
            external: ['@rspack/*'],
        })
        console.log(`Lambda bundle written to ${outputFile}`)
        console.log(`\nDeploy instructions:`)
        console.log(`  1. Create a staging directory with just this file:`)
        console.log(`       mkdir -p lambda-deploy && cp ${outputFile} lambda-deploy/lambda.mjs`)
        console.log(`  2. Upload lambda-deploy/ as your Lambda function code`)
        console.log(`  3. Set handler to: lambda.handler  (runtime: Node.js 20.x)`)
        console.log(`  4. Upload .hadars/static/ assets to S3 and serve via CloudFront`)
        console.log(`     (the Lambda handler does not serve static JS/CSS — route those to S3)`)
    } finally {
        await unlink(shimPath).catch(() => {})
    }
}



// ── Terminal UI ───────────────────────────────────────────────────────────────

const _R  = '\x1B[0m'
const _B  = '\x1B[1m'
const _D  = '\x1B[2m'
const _C  = '\x1B[36m'
const _G  = '\x1B[32m'
const _UP_KEY    = '\x1B[A'
const _DOWN_KEY  = '\x1B[B'
const _HIDE = '\x1B[?25l'
const _SHOW = '\x1B[?25h'

const _cl  = () => '\r\x1B[2K'
const _up  = (n: number) => n > 0 ? `\x1B[${n}A` : ''

function _readKeys(handler: (key: string) => boolean): Promise<void> {
  return new Promise(resolve => {
    const { stdin } = process
    const wasRaw = stdin.isTTY && (stdin as any).isRaw
    if (stdin.isTTY) stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf-8')
    const onData = (key: string) => {
      if (key === '\x03') { cleanup(); process.stdout.write(_SHOW); process.exit(130) }
      if (handler(key)) cleanup()
    }
    const cleanup = () => {
      stdin.removeListener('data', onData)
      if (stdin.isTTY && !wasRaw) stdin.setRawMode(false)
      stdin.pause()
      resolve()
    }
    stdin.on('data', onData)
  })
}

async function promptRadio(question: string, options: string[]): Promise<number> {
  const out = process.stdout
  let cursor = 0
  const total = 1 + options.length

  const render = (redraw: boolean) => {
    if (redraw) out.write(_up(total))
    out.write(`${_cl()}  ${_B}${question}${_R}\n`)
    for (let i = 0; i < options.length; i++) {
      const arrow = i === cursor ? `${_C}❯${_R}` : ' '
      const text  = i === cursor ? `${_B}${options[i]}${_R}` : `${_D}${options[i]}${_R}`
      out.write(`${_cl()}  ${arrow} ${text}\n`)
    }
  }

  out.write(_HIDE)
  render(false)
  await _readKeys(key => {
    if      (key === _UP_KEY   && cursor > 0)                   { cursor--; render(true) }
    else if (key === _DOWN_KEY && cursor < options.length - 1)  { cursor++; render(true) }
    else if (key === '\r')                                       { return true }
    return false
  })

  out.write(_up(total))
  out.write(`${_cl()}  ${question}  ${_C}${_B}${options[cursor]}${_R}\n`)
  for (let i = 0; i < options.length; i++) out.write(`${_cl()}\n`)
  out.write(_up(options.length))
  out.write(_SHOW)
  return cursor
}

async function promptMultiSelect(question: string, options: string[]): Promise<number[]> {
  const out = process.stdout
  let cursor = 0
  const selected = new Set<number>()
  const total = 2 + options.length  // question + hint + options

  const render = (redraw: boolean) => {
    if (redraw) out.write(_up(total))
    out.write(`${_cl()}  ${_B}${question}${_R}\n`)
    out.write(`${_cl()}  ${_D}↑↓ navigate · Space select · Enter confirm${_R}\n`)
    for (let i = 0; i < options.length; i++) {
      const arrow   = i === cursor ? `${_C}❯${_R}` : ' '
      const box     = selected.has(i) ? `${_G}●${_R}` : `${_D}○${_R}`
      const text    = i === cursor ? `${_B}${options[i]}${_R}` : `${_D}${options[i]}${_R}`
      out.write(`${_cl()}  ${arrow} ${box}  ${text}\n`)
    }
  }

  out.write(_HIDE)
  render(false)
  await _readKeys(key => {
    if      (key === _UP_KEY   && cursor > 0)                   { cursor--; render(true) }
    else if (key === _DOWN_KEY && cursor < options.length - 1)  { cursor++; render(true) }
    else if (key === ' ')  { selected.has(cursor) ? selected.delete(cursor) : selected.add(cursor); render(true) }
    else if (key === '\r')                                       { return true }
    return false
  })

  const picked = [...selected].sort((a, b) => a - b)
  const summary = picked.length > 0 ? picked.map(i => options[i]).join(', ') : 'none'
  out.write(_up(total))
  out.write(`${_cl()}  ${question}  ${_C}${_B}${summary}${_R}\n`)
  for (let i = 0; i < total - 1; i++) out.write(`${_cl()}\n`)
  out.write(_up(total - 1))
  out.write(_SHOW)
  return picked
}

// ── Plugin metadata ───────────────────────────────────────────────────────────

interface PluginMeta {
  pkg: string
  version: string
  label: string
}

const PLUGINS: PluginMeta[] = [
  { pkg: '@swc/plugin-emotion',             version: '12.0.0', label: 'Emotion (CSS-in-JS)' },
  { pkg: '@swc/plugin-styled-components',   version: '10.0.0', label: 'styled-components' },
  { pkg: '@swc/plugin-relay',               version: '10.0.0', label: 'Relay (GraphQL)' },
  { pkg: '@swc/plugin-styled-jsx',          version: '11.0.0', label: 'styled-jsx' },
  { pkg: '@swc/plugin-transform-imports',   version: '10.0.0', label: 'transform-imports' },
  { pkg: '@swc/plugin-loadable-components', version: '9.0.0',  label: 'Loadable Components' },
  { pkg: '@swc/plugin-formatjs',            version: '7.0.0',  label: 'FormatJS (i18n)' },
]

function renderSwcPluginsConfig(plugins: PluginMeta[]): string {
  if (plugins.length === 0) return ''
  const lines = plugins.map(p => {
    if (p.pkg === '@swc/plugin-relay') {
      return `    ['${p.pkg}', { rootDir: process.cwd(), artifactDirectory: 'src/__generated__' }],`
    }
    return `    ['${p.pkg}', {}],`
  })
  return `\n  swcPlugins: [\n${lines.join('\n')}\n  ],`
}

// ── Template generators ───────────────────────────────────────────────────────

interface ScaffoldOptions {
  useTypeScript: boolean
  plugins: PluginMeta[]
}


function buildTemplates(name: string, opts: ScaffoldOptions): Record<string, string> {
  const { useTypeScript, plugins } = opts
  const appExt  = useTypeScript ? 'tsx' : 'jsx'
  const cfgExt  = useTypeScript ? 'ts'  : 'js'
  const tsOrJs  = useTypeScript ? 'tsconfig.json' : 'jsconfig.json'

  const pluginDeps: Record<string, string> = {}
  for (const p of plugins) pluginDeps[p.pkg] = p.version

  const packageJson = JSON.stringify({
    name,
    version: '0.1.0',
    type: 'module',
    private: true,
    scripts: {
      dev:   'hadars dev',
      build: 'hadars build',
      start: 'hadars run',
    },
    dependencies: {
      hadars:      'latest',
      react:       '^19.0.0',
      'react-dom': '^19.0.0',
    },
    ...(Object.keys(pluginDeps).length > 0 ? { devDependencies: pluginDeps } : {}),
  }, null, 2) + '\n'

  const swcSection = renderSwcPluginsConfig(plugins)

  const hadarsConfig = useTypeScript
    ? `import type { HadarsOptions } from 'hadars';\n\nconst config: HadarsOptions = {\n  entry: 'src/App.tsx',\n  port: 3000,${swcSection}\n};\n\nexport default config;\n`
    : `/** @type {import('hadars').HadarsOptions} */\nconst config = {\n  entry: 'src/App.jsx',\n  port: 3000,${swcSection}\n};\n\nexport default config;\n`

  const tsConfigContent = useTypeScript
    ? JSON.stringify({
        compilerOptions: {
          lib:                        ['ESNext', 'DOM'],
          target:                     'ESNext',
          module:                     'Preserve',
          moduleDetection:            'force',
          jsx:                        'react-jsx',
          moduleResolution:           'bundler',
          allowImportingTsExtensions: true,
          verbatimModuleSyntax:       true,
          noEmit:                     true,
          strict:                     true,
          skipLibCheck:               true,
        },
      }, null, 2) + '\n'
    : JSON.stringify({
        compilerOptions: {
          lib:              ['ESNext', 'DOM'],
          target:           'ESNext',
          module:           'ESNext',
          moduleResolution: 'bundler',
          jsx:              'react-jsx',
          checkJs:          true,
          noEmit:           true,
          skipLibCheck:     true,
        },
      }, null, 2) + '\n'

  const appImports = useTypeScript
    ? `import React from 'react';\nimport { HadarsHead, type HadarsApp } from 'hadars';`
    : `import React from 'react';\nimport { HadarsHead } from 'hadars';`

  const appSignature = useTypeScript
    ? `const App: HadarsApp<{}> = () => {`
    : `const App = () => {`

  const appContent =
`${appImports}

${appSignature}
  const [count, setCount] = React.useState(0);

  return (
    <>
      <HadarsHead status={200}>
        <title>${name}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </HadarsHead>

      <main style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '4rem auto', padding: '0 1rem', textAlign: 'center' }}>
        <h1>${name}</h1>
        <p style={{ color: '#666', margin: '1rem 0 2rem' }}>
          Edit <code>src/App.${appExt}</code> to get started.
        </p>
        <p style={{ fontSize: '3rem', margin: '1rem 0' }}>{count}</p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
          <button onClick={() => setCount(c => c - 1)}>−</button>
          <button onClick={() => setCount(c => c + 1)}>+</button>
        </div>
      </main>
    </>
  );
};

export default App;
`

  return {
    'package.json':                    packageJson,
    [`hadars.config.${cfgExt}`]:       hadarsConfig,
    [tsOrJs]:                          tsConfigContent,
    '.gitignore':                      'node_modules/\n.hadars/\ndist/\n',
    [`src/App.${appExt}`]:             appContent,
  }
}

async function createProject(name: string, cwd: string): Promise<void> {
  const dir = resolve(cwd, name)

  if (existsSync(dir)) {
    console.error(`Directory already exists: ${dir}`)
    process.exit(1)
  }

  // ── Interactive prompts ──────────────────────────────────────────────────
  const useTypeScript = (await promptRadio('Language?', ['TypeScript', 'JavaScript'])) === 0

  const selectedIndices = await promptMultiSelect(
    'Select SWC plugins to enable (optional):',
    PLUGINS.map(p => p.label),
  )
  const plugins = selectedIndices.map(i => PLUGINS[i]!)

  // ── Write files ──────────────────────────────────────────────────────────
  console.log(`\nCreating hadars project in ${dir}`)

  await mkdir(join(dir, 'src'), { recursive: true })

  const files = buildTemplates(name, { useTypeScript, plugins })

  for (const [file, content] of Object.entries(files)) {
    await writeFile(join(dir, file), content, 'utf-8')
    console.log(`  created  ${file}`)
  }

  const installHint = plugins.length > 0
    ? `\n  # Also install selected SWC plugins:\n  npm install -D ${plugins.map(p => `${p.pkg}@${p.version}`).join(' ')}\n`
    : ''

  console.log(`
Done! Next steps:

  cd ${name}
  npm install       # or: bun install / pnpm install${installHint}
  npm run dev       # or: bun run dev
`)
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

function usage(): void {
  console.log('Usage: hadars <new <name> | dev | build | run | export lambda [output.mjs] | export cloudflare [output.mjs] | export static [outDir] | export schema [schema.graphql]>')
}

export async function runCli(argv: string[], cwd = process.cwd()): Promise<void> {
  const cmd = argv[2]

  if (cmd === 'new') {
    const name = argv[3]
    if (!name) {
      console.error('Usage: hadars new <project-name>')
      process.exit(1)
    }
    try {
      await createProject(name, cwd)
    } catch (err: any) {
      console.error('Failed to create project:', err?.message ?? err)
      process.exit(2)
    }
    return
  }

  if (!cmd || !['dev', 'build', 'run', 'export'].includes(cmd)) {
    usage()
    process.exit(1)
  }

  const configPath = findConfig(cwd)
  if (!configPath) {
    console.log(`No hadars.config.* found in ${cwd}`)
    console.log('Proceeding with default behavior (no config)')
    return
  }

  try {
    const cfg = await loadConfig(configPath)
    console.log(`Loaded config from ${configPath}`)
    switch (cmd) {
        case 'dev':
            console.log('Starting development server...')
            await dev(cfg);
            break;
        case 'build':
            console.log('Building project...')
            await build(cfg);
            console.log('Build complete')
            process.exit(0)
        case 'export': {
            const subCmd = argv[3]
            if (subCmd === 'lambda') {
                const outputFile = resolve(cwd, argv[4] ?? 'lambda.mjs')
                await bundleLambda(cfg, configPath, outputFile, cwd)
                process.exit(0)
            } else if (subCmd === 'cloudflare') {
                const outputFile = resolve(cwd, argv[4] ?? 'cloudflare.mjs')
                await bundleCloudflare(cfg, configPath, outputFile, cwd)
                process.exit(0)
            } else if (subCmd === 'static') {
                const outDirArg = argv[4] ?? 'out'
                await exportStatic(cfg, outDirArg, cwd)
                process.exit(0)
            } else if (subCmd === 'schema') {
                const outputFile = resolve(cwd, argv[4] ?? 'schema.graphql')
                await exportSchema(cfg, outputFile)
                process.exit(0)
            } else {
                console.error(`Unknown export target: ${subCmd ?? '(none)'}. Supported: lambda, cloudflare, static, schema`)
                process.exit(1)
            }
        }
        case 'run':
            console.log('Running project...')
            await run(cfg);
            break;
    }
  } catch (err: any) {
    console.error('Failed to load config:', err?.message ?? err)
    process.exit(2)
  }
}
