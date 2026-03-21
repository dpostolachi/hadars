import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const GettingStarted: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>Getting Started — hadars</title>
            <meta name="description" content="Scaffold a new project or add hadars to an existing React app in a few steps." />
            <meta property="og:title" content="Getting Started — hadars" />
            <meta property="og:description" content="Scaffold a new project or add hadars to an existing React app in a few steps." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">Getting Started</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">Scaffold a project or drop hadars into an existing React app.</p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Scaffold a new project</h2>
            <p className="text-muted-foreground mb-4">Creates a project with TypeScript and Tailwind already wired in:</p>
            <Code lang="bash">{`
npx hadars new my-app
cd my-app
npm install
npm run dev
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Manual installation</h2>
            <p className="text-muted-foreground mb-4">Add hadars to an existing project:</p>
            <Code lang="bash">npm install hadars</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">1 — hadars.config.ts</h2>
            <p className="text-muted-foreground mb-4">Create a config file at the root of your project. The only required field is <code className="text-sm bg-muted px-1.5 py-0.5 rounded">entry</code>:</p>
            <Code lang="typescript">{`
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    port: 3000,
};

export default config;
            `}</Code>
            <p className="text-muted-foreground mb-4">For a multi-core production server:</p>
            <Code lang="typescript">{`
import os from 'os';
import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    port: 3000,
    workers: os.cpus().length,
};

export default config;
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">2 — src/App.tsx</h2>
            <p className="text-muted-foreground mb-4">
                Export a default React component and an optional <code className="text-sm bg-muted px-1.5 py-0.5 rounded">getInitProps</code> function.
                Place <code className="text-sm bg-muted px-1.5 py-0.5 rounded">HadarsHead</code> anywhere in the tree — no wrapper component needed.
            </p>
            <Code>{`
import React from 'react';
import {
    HadarsHead,
    type HadarsApp,
    type HadarsRequest,
} from 'hadars';

interface Props {
    user: { name: string; email: string };
}

const App: HadarsApp<Props> = ({ user }) => (
    <>
        <HadarsHead status={200}>
            <title>Hello {user.name}</title>
            <meta name="description" content="My hadars app" />
        </HadarsHead>
        <main>
            <h1>Hello, {user.name}!</h1>
            <p>{user.email}</p>
        </main>
    </>
);

// Runs on the server for every request.
export const getInitProps = async (req: HadarsRequest): Promise<Props> => {
    const user = await db.getUser(req.cookies.session);
    return { user };
};

export default App;
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Static files</h2>
            <p className="text-muted-foreground mb-4">
                Place images, fonts, favicons, <code className="text-sm bg-muted px-1.5 py-0.5 rounded">robots.txt</code>, and
                any other static assets in a <code className="text-sm bg-muted px-1.5 py-0.5 rounded">static/</code> directory at your project root.
                hadars serves them automatically — no config needed.
            </p>
            <Code lang="bash">{`
my-app/
├── static/
│   ├── logo.png
│   ├── favicon.ico
│   └── robots.txt    # served at /robots.txt
├── src/
│   └── App.tsx
└── hadars.config.ts
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">3 — CLI</h2>
            <Code lang="bash">{`
# Development server with React Fast Refresh HMR
hadars dev

# Production build — client + SSR compiled in parallel
hadars build

# Serve the production build
hadars run

# Bundle into a single self-contained Lambda .mjs
hadars export lambda [output.mjs]
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">HadarsRequest</h2>
            <p className="text-muted-foreground mb-4">The request object passed to <code className="text-sm bg-muted px-1.5 py-0.5 rounded">getInitProps</code> extends the standard <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Request</code> with:</p>
            <Code lang="typescript">{`
interface HadarsRequest extends Request {
    pathname: string;               // e.g. "/blog/my-post"
    search: string;                 // e.g. "?page=2"
    location: string;               // pathname + search
    cookies: Record<string, string>;
}
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Lifecycle hooks</h2>
            <p className="text-muted-foreground mb-4">Beyond <code className="text-sm bg-muted px-1.5 py-0.5 rounded">getInitProps</code>, you can optionally export:</p>
            <div className="rounded-xl overflow-hidden divide-y mb-4" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.15)", boxShadow: "0 0 20px oklch(0.68 0.28 285 / 0.04)" }}>
                <div className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: "oklch(0.12 0.04 280)", color: "oklch(0.60 0.08 285)" }}>
                    <span>Export</span><span>Runs on</span><span>Purpose</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">getInitProps</code>
                    <span className="text-muted-foreground">server</span>
                    <span className="text-muted-foreground">Fetch data from the incoming request. Return props passed to the app component.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">getFinalProps</code>
                    <span className="text-muted-foreground">server</span>
                    <span className="text-muted-foreground">Strip server-only fields before props are serialised into the page JSON for the client.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">getClientProps</code>
                    <span className="text-muted-foreground">client</span>
                    <span className="text-muted-foreground">Enrich props with browser-only data (localStorage, device APIs) after the page loads.</span>
                </div>
            </div>
            <Code>{`
export const getFinalProps = async ({ secret, ...props }: Props) => {
    // "secret" will not appear in the client bundle's JSON payload
    return props;
};

export const getClientProps = async (props: PublicProps) => {
    return {
        ...props,
        theme: localStorage.getItem('theme') ?? 'dark',
    };
};
            `}</Code>
        </section>

        <footer className="mt-16 pt-8 text-center text-sm text-muted-foreground" style={{ borderTop: "1px solid oklch(0.68 0.28 285 / 0.15)" }}><p>hadars — MIT licence</p></footer>
    </>
);

export default GettingStarted;
