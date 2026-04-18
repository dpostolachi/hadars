import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const PLUGINS: [string, string][] = [
    ['@swc/plugin-relay', '10.0.0'],
    ['@swc/plugin-emotion', '12.0.0'],
    ['@swc/plugin-styled-components', '10.0.0'],
    ['@swc/plugin-styled-jsx', '11.0.0'],
    ['@swc/plugin-jest', '10.0.0'],
    ['@swc/plugin-formatjs', '7.0.0'],
    ['@swc/plugin-transform-imports', '10.0.0'],
    ['@swc/plugin-loadable-components', '9.0.0'],
    ['@swc/plugin-prefresh', '10.0.0'],
    ['swc-plugin-css-modules', '6.0.0'],
    ['swc-plugin-pre-paths', '6.0.0'],
    ['swc-plugin-transform-remove-imports', '7.0.0'],
    ['@lingui/swc-plugin', '5.9.0'],
];

const SwcPlugins: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>SWC Plugins — hadars</title>
            <meta name="description" content="How to use SWC compiler plugins (Relay, emotion, styled-components, etc.) with hadars and @rspack/core, including the version compatibility table." />
            <meta property="og:title" content="SWC Plugins — hadars" />
            <meta property="og:description" content="How to use SWC compiler plugins (Relay, emotion, styled-components, etc.) with hadars and @rspack/core, including the version compatibility table." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">SWC Plugins</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            Apply compiler transforms — Relay, emotion, styled-components, and more — to every file
            in both the client and SSR bundles via the <code className="text-sm bg-muted px-1.5 py-0.5 rounded">swcPlugins</code> option.
        </p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Configuration</h2>
            <p className="text-muted-foreground mb-4">
                Add plugins to <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars.config.ts</code>. Each entry is a tuple of{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">[packageName, pluginOptions]</code>, the same format rspack and
                Next.js use for SWC plugins.
            </p>
            <Code lang="typescript">{`
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    swcPlugins: [
        ['@swc/plugin-relay', {
            rootDir: process.cwd(),
            artifactDirectory: 'src/__generated__',
            language: 'typescript',
        }],
    ],
};

export default config;
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Version compatibility</h2>
            <p className="text-muted-foreground mb-3">
                SWC plugins are native WebAssembly modules compiled against a specific version of{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">swc_core</code>. A version mismatch causes a silent
                failure or a hard crash at build time — there is no graceful error. You must install the
                exact version that matches rspack's internal SWC.
            </p>
            <p className="text-muted-foreground mb-4">
                Install the <strong>exact</strong> version listed — do not use{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">latest</code> or a semver range such as{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">^10.0.0</code>.
                The table below is for <strong>{'@rspack/core@1.6.8'}</strong>. For other rspack
                versions check{' '}
                <a href="https://plugins.swc.rs" className="text-primary underline" target="_blank" rel="noopener noreferrer">
                    plugins.swc.rs
                </a>.
            </p>

            <div className="rounded-xl overflow-hidden divide-y mb-6" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.15)", boxShadow: "0 0 20px oklch(0.68 0.28 285 / 0.04)" }}>
                <div className="grid grid-cols-2 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: "oklch(0.12 0.04 280)", color: "oklch(0.60 0.08 285)" }}>
                    <span>Plugin</span><span>Exact version</span>
                </div>
                {PLUGINS.map(([pkg, ver]) => (
                    <div key={pkg} className="grid grid-cols-2 gap-4 px-4 py-2.5 text-sm">
                        <code className="text-primary">{pkg}</code>
                        <code className="text-muted-foreground">{ver}</code>
                    </div>
                ))}
            </div>

            <p className="text-sm text-muted-foreground">
                The <code className="text-sm bg-muted px-1 rounded">@swc/core</code> package in hadars's{' '}
                <code className="text-sm bg-muted px-1 rounded">optionalDependencies</code> is used only by hadars's own
                loader for AST transforms. It is a separate concern from the SWC version bundled inside
                rspack that executes your plugins — you do not need them to match.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Example: Relay</h2>
            <p className="text-muted-foreground mb-4">
                Install the exact compatible version:
            </p>
            <Code lang="bash">{`bun add -d @swc/plugin-relay@10.0.0`}</Code>
            <p className="text-muted-foreground mt-4 mb-4">
                Configure in <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars.config.ts</code>:
            </p>
            <Code lang="typescript">{`
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    swcPlugins: [
        ['@swc/plugin-relay', {
            rootDir: process.cwd(),
            artifactDirectory: 'src/__generated__',
            language: 'typescript',
        }],
    ],
};

export default config;
            `}</Code>
            <p className="text-muted-foreground mt-4">
                Relay components that use <code className="text-sm bg-muted px-1.5 py-0.5 rounded">loadModule</code> for code splitting
                will have the Relay transform applied during the rspack SSR build, so fragment references
                and generated types resolve correctly on both client and server.
            </p>
        </section>
    </>
);

export default SwcPlugins;
