import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import * as Hadars from './src/build'
import type { HadarsOptions } from './src/types/ninety'

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

// ── hadars new ────────────────────────────────────────────────────────────────

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

const App: HadarsApp<{}> = ({ context }) => (
  <HadarsContext context={context}>
    <HadarsHead status={200}>
      <title>My App</title>
    </HadarsHead>
    <main>
      <h1>Hello from hadars!</h1>
      <p>Edit <code>src/App.tsx</code> to get started.</p>
    </main>
  </HadarsContext>
);

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
  console.log('Usage: hadars <new <name> | dev | build | run>')
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

  if (!cmd || !['dev', 'build', 'run'].includes(cmd)) {
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
