import { existsSync } from 'node:fs'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import * as Hadars from './src/build'
import type { HadarsOptions } from './src/types/hadars'

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
    const shimPath = join(tmpdir(), `hadars-lambda-shim-${Date.now()}.ts`)
    const shim = [
        `import * as ssrModule from ${JSON.stringify(ssrBundle)};`,
        `import outHtml from ${JSON.stringify(outHtml)};`,
        `import { createLambdaHandler } from 'hadars/lambda';`,
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



const TEMPLATES: Record<string, (name: string) => string> = {
  'package.json': (name: string) => JSON.stringify({
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
      'hadars': 'latest',
      react:      '^19.0.0',
      'react-dom':'^19.0.0',
    },
  }, null, 2) + '\n',

  'hadars.config.ts': () =>
`import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
  entry: 'src/App.tsx',
  port: 3000,
};

export default config;
`,

  'tsconfig.json': () => JSON.stringify({
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
  }, null, 2) + '\n',

  '.gitignore': () =>
`node_modules/
.hadars/
dist/
`,

  'src/App.tsx': () =>
`import React from 'react';
import { HadarsContext, HadarsHead, type HadarsApp } from 'hadars';

const css = \`
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f0f13;
    color: #e2e8f0;
    min-height: 100vh;
  }

  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 2rem;
    border-bottom: 1px solid #1e1e2e;
  }
  .nav-brand { font-weight: 700; font-size: 1.1rem; color: #a78bfa; letter-spacing: -0.02em; }
  .nav-links { display: flex; gap: 1.5rem; }
  .nav-links a { color: #94a3b8; text-decoration: none; font-size: 0.9rem; }
  .nav-links a:hover { color: #e2e8f0; }

  .hero {
    text-align: center;
    padding: 5rem 1rem 4rem;
    max-width: 680px;
    margin: 0 auto;
  }
  .hero-badge {
    display: inline-block;
    background: #1e1a2e;
    border: 1px solid #4c1d95;
    color: #a78bfa;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 0.3rem 0.8rem;
    border-radius: 999px;
    margin-bottom: 1.5rem;
  }
  .hero h1 {
    font-size: clamp(2rem, 5vw, 3.25rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.15;
    margin-bottom: 1rem;
  }
  .hero h1 span { color: #a78bfa; }
  .hero p {
    font-size: 1.1rem;
    color: #94a3b8;
    line-height: 1.7;
    margin-bottom: 2.5rem;
  }
  .hero-actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.65rem 1.4rem;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s, transform 0.1s;
    text-decoration: none;
  }
  .btn:hover { opacity: 0.85; transform: translateY(-1px); }
  .btn:active { transform: translateY(0); }
  .btn-primary { background: #7c3aed; color: #fff; }
  .btn-ghost { background: #1e1e2e; color: #e2e8f0; border: 1px solid #2d2d3e; }

  .features {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
    max-width: 900px;
    margin: 0 auto 4rem;
    padding: 0 1.5rem;
  }
  .card {
    background: #16161f;
    border: 1px solid #1e1e2e;
    border-radius: 12px;
    padding: 1.5rem;
  }
  .card-icon { font-size: 1.5rem; margin-bottom: 0.75rem; }
  .card h3 { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.4rem; }
  .card p { font-size: 0.85rem; color: #64748b; line-height: 1.6; }

  .demo {
    max-width: 480px;
    margin: 0 auto 4rem;
    padding: 0 1.5rem;
    text-align: center;
  }
  .demo-box {
    background: #16161f;
    border: 1px solid #1e1e2e;
    border-radius: 12px;
    padding: 2rem;
  }
  .demo-box h2 { font-size: 0.8rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 1.25rem; }
  .counter { font-size: 3.5rem; font-weight: 800; color: #a78bfa; letter-spacing: -0.04em; margin-bottom: 1.25rem; }
  .demo-actions { display: flex; gap: 0.75rem; justify-content: center; }

\`;

const App: HadarsApp<{}> = ({ context }) => {
  const [count, setCount] = React.useState(0);

  return (
    <HadarsContext context={context}>
      <HadarsHead status={200}>
        <title>My App</title>
        <meta id="viewport" name="viewport" content="width=device-width, initial-scale=1" />
        <style id="app-styles" dangerouslySetInnerHTML={{ __html: css }} />
      </HadarsHead>

      <nav className="nav">
        <span className="nav-brand">my-app</span>
        <div className="nav-links">
          <a href="https://github.com/dpostolachi/hadar" target="_blank" rel="noopener">github</a>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-badge">built with hadars</div>
        <h1>Ship <span>React apps</span><br />at full speed</h1>
        <p>
          SSR out of the box, zero config, instant hot-reload.
          Edit <code>src/App.tsx</code> to get started.
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => setCount(c => c + 1)}>
            Try the counter ↓
          </button>
        </div>
      </section>

      <div className="features">
        <div className="card">
          <div className="card-icon">⚡</div>
          <h3>Server-side rendering</h3>
          <p>Pages render on the server and hydrate on the client — great for SEO and first paint.</p>
        </div>
        <div className="card">
          <div className="card-icon">🔥</div>
          <h3>Hot module reload</h3>
          <p>Changes in <code>src/App.tsx</code> reflect instantly in the browser during development.</p>
        </div>
        <div className="card">
          <div className="card-icon">📦</div>
          <h3>Zero config</h3>
          <p>One config file. Export a React component, run <code>hadars dev</code>, done.</p>
        </div>
        <div className="card">
          <div className="card-icon">🗄️</div>
          <h3>Server data hooks</h3>
          <p>Use <code>useServerData</code> to fetch data on the server without extra round-trips.</p>
        </div>
      </div>

      <div className="demo">
        <div className="demo-box">
          <h2>Client interactivity works</h2>
          <div className="counter">{count}</div>
          <div className="demo-actions">
            <button className="btn btn-ghost" onClick={() => setCount(c => c - 1)}>− dec</button>
            <button className="btn btn-primary" onClick={() => setCount(c => c + 1)}>+ inc</button>
          </div>
        </div>
      </div>

    </HadarsContext>
  );
};

export default App;
`,
}

async function createProject(name: string, cwd: string): Promise<void> {
  const dir = resolve(cwd, name)

  if (existsSync(dir)) {
    console.error(`Directory already exists: ${dir}`)
    process.exit(1)
  }

  console.log(`Creating hadars project in ${dir}`)

  await mkdir(join(dir, 'src'), { recursive: true })

  for (const [file, template] of Object.entries(TEMPLATES)) {
    const content = template(name)
    await writeFile(join(dir, file), content, 'utf-8')
    console.log(`  created  ${file}`)
  }

  console.log(`
Done! Next steps:

  cd ${name}
  npm install       # or: bun install / pnpm install
  npm run dev       # or: bun run dev
`)
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

function usage(): void {
  console.log('Usage: hadars <new <name> | dev | build | run | export lambda [output.mjs]>')
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
            if (subCmd !== 'lambda') {
                console.error(`Unknown export target: ${subCmd ?? '(none)'}. Did you mean: hadars export lambda`)
                process.exit(1)
            }
            const outputFile = resolve(cwd, argv[4] ?? 'lambda.mjs')
            await bundleLambda(cfg, configPath, outputFile, cwd)
            process.exit(0)
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
