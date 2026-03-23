import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const c = (s: string) => (
    <code className="text-sm bg-muted px-1.5 py-0.5 rounded">{s}</code>
);

const StaticExport: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>Static Export &amp; Sources — hadars</title>
            <meta name="description" content="Pre-render hadars apps to static HTML files and use Gatsby-compatible source plugins to pull in data from any CMS or API." />
            <meta property="og:title" content="Static Export & Sources — hadars" />
            <meta property="og:description" content="Pre-render hadars apps to static HTML files and use Gatsby-compatible source plugins to pull in data from any CMS or API." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">Static Export &amp; Sources</h1>

        {/* Experimental notice */}
        <div
            className="flex items-start gap-3 rounded-xl px-4 py-3 mb-6 text-sm"
            style={{
                background: 'oklch(0.20 0.08 60 / 0.25)',
                border: '1px solid oklch(0.75 0.18 60 / 0.35)',
                color: 'oklch(0.88 0.12 60)',
            }}
        >
            <span style={{ fontSize: '1.1em', lineHeight: 1.4 }}>⚠</span>
            <span>
                <strong>Experimental.</strong> Static export and Gatsby-compatible source plugins are
                new features. The API — including config shape, context object, and schema inference
                behaviour — may change in future releases without a major version bump.
            </span>
        </div>

        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            Pre-render every page to a plain HTML file and deploy to any static host —
            no server required. Pull data from any CMS or API using Gatsby-compatible source plugins.
        </p>

        {/* ── Static export ───────────────────────────────────────── */}
        <section className="mb-12">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">hadars export static</h2>
            <p className="text-muted-foreground mb-4">
                {c('hadars export static')} builds the project and pre-renders a list of URL paths
                to {c('index.html')} files. Each page also gets an {c('index.json')} sidecar so
                {' '}{c('useServerData')} keeps working on client-side navigation without a live server.
            </p>
            <Code lang="bash">{`
# Output goes to out/ by default
hadars export static

# Custom output directory
hadars export static dist
            `}</Code>

            <h3 className="text-lg font-semibold mb-3 mt-8 text-gradient-soft">Minimal config</h3>
            <p className="text-muted-foreground mb-4">
                Add a {c('paths')} function to {c('hadars.config.ts')} that returns the list of URLs
                to pre-render. That's all that's required.
            </p>
            <Code lang="typescript">{`
// hadars.config.ts
import type { HadarsOptions } from 'hadars';

export default {
    entry: './src/App.tsx',

    paths: () => ['/', '/about', '/contact'],
} satisfies HadarsOptions;
            `}</Code>

            <h3 className="text-lg font-semibold mb-3 mt-8 text-gradient-soft">Output layout</h3>
            <Code lang="bash">{`
out/
├── index.html          # /
├── index.json          # useServerData sidecar for /
├── about/
│   ├── index.html      # /about
│   └── index.json
├── contact/
│   ├── index.html      # /contact
│   └── index.json
└── static/             # JS, CSS, fonts — copied from .hadars/static/
    ├── index.js
    └── ...
            `}</Code>
            <p className="text-muted-foreground mt-4">
                Serve {c('out/')} from any static host — Vercel, Netlify, Cloudflare Pages, S3, or
                a plain nginx. No server-side code required.
            </p>

            <h3 className="text-lg font-semibold mb-3 mt-8 text-gradient-soft">Data in static pages</h3>
            <p className="text-muted-foreground mb-4">
                {c('getInitProps')} receives a {c('HadarsStaticContext')} as its second argument during
                static export. Use it to fetch data from a database, API, or the GraphQL layer (see below).
            </p>
            <Code lang="typescript">{`
// src/App.tsx
import type { HadarsApp, HadarsRequest, HadarsStaticContext } from 'hadars';

interface Props { posts: Post[] }

const App: HadarsApp<Props> = ({ posts }) => (
    <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
);

export const getInitProps = async (
    req: HadarsRequest,
    ctx?: HadarsStaticContext,
): Promise<Props> => {
    // ctx is only present during static export (and dev with sources configured)
    if (!ctx) return { posts: [] };
    const { data } = await ctx.graphql('{ allPost { id title } }');
    return { posts: data?.allPost ?? [] };
};

export default App;
            `}</Code>
        </section>

        {/* ── Source plugins ───────────────────────────────────────── */}
        <section className="mb-12">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Source plugins</h2>
            <p className="text-muted-foreground mb-4">
                hadars source plugins follow the same API as Gatsby's {c('sourceNodes')} — so most
                existing Gatsby CMS source plugins work out of the box. Each plugin creates typed
                nodes in an in-memory store; hadars infers a GraphQL schema automatically and
                exposes it to {c('paths()')} and {c('getInitProps()')}.
            </p>
            <p className="text-muted-foreground mb-4">
                During {c('hadars dev')}, a GraphiQL IDE is served at{' '}
                {c('/__hadars/graphql')} so you can explore the inferred schema while you build.
            </p>

            <h3 className="text-lg font-semibold mb-3 mt-6 text-gradient-soft">Install graphql</h3>
            <p className="text-muted-foreground mb-4">
                Schema inference requires {c('graphql')} to be installed in your project:
            </p>
            <Code lang="bash">{`npm install graphql`}</Code>

            <h3 className="text-lg font-semibold mb-3 mt-8 text-gradient-soft">Config</h3>
            <p className="text-muted-foreground mb-4">
                Add a {c('sources')} array to your config. Each entry mirrors Gatsby's plugin format:
                a {c('resolve')} (package name or pre-imported module) and an optional {c('options')} object.
            </p>
            <Code lang="typescript">{`
// hadars.config.ts
import type { HadarsOptions, HadarsStaticContext } from 'hadars';

export default {
    entry: './src/App.tsx',

    sources: [
        {
            resolve: 'gatsby-source-contentful',
            options: {
                spaceId: process.env.CONTENTFUL_SPACE_ID,
                accessToken: process.env.CONTENTFUL_ACCESS_TOKEN,
            },
        },
    ],

    paths: async ({ graphql }: HadarsStaticContext) => {
        const { data } = await graphql(\`{
            allContentfulBlogPost { slug }
        }\`);
        const slugs = data?.allContentfulBlogPost?.map((p: any) => p.slug) ?? [];
        return ['/', ...slugs.map((s: string) => \`/post/\${s}\`)];
    },
} satisfies HadarsOptions;
            `}</Code>

            <h3 className="text-lg font-semibold mb-3 mt-8 text-gradient-soft">Local source plugin</h3>
            <p className="text-muted-foreground mb-4">
                Pass a pre-imported module instead of a package name to use a local plugin without
                publishing it to npm. The module must export a {c('sourceNodes')} function.
            </p>
            <Code lang="typescript">{`
// src/posts-source.ts
export async function sourceNodes(
    { actions, createNodeId, createContentDigest, reporter }: any,
    options: { dataDir: string } = {},
) {
    const { createNode } = actions;
    const posts = await fetchPostsFromMyApi();

    for (const post of posts) {
        createNode({
            ...post,
            id: createNodeId(post.slug),
            internal: {
                type: 'BlogPost',
                contentDigest: createContentDigest(post),
            },
        });
    }

    reporter.info(\`Created \${posts.length} BlogPost nodes\`);
}
            `}</Code>
            <Code lang="typescript">{`
// hadars.config.ts
import * as postsSource from './src/posts-source';

export default {
    entry: './src/App.tsx',
    sources: [
        { resolve: postsSource },
    ],
    paths: async ({ graphql }) => {
        const { data } = await graphql('{ allBlogPost { slug } }');
        return ['/', ...(data?.allBlogPost ?? []).map((p: any) => \`/post/\${p.slug}\`)];
    },
} satisfies HadarsOptions;
            `}</Code>

            <h3 className="text-lg font-semibold mb-3 mt-8 text-gradient-soft">Inferred GraphQL schema</h3>
            <p className="text-muted-foreground mb-4">
                hadars inspects the fields on each node type and generates a GraphQL schema
                automatically. For each type (e.g. {c('BlogPost')}) you get two root queries:
            </p>
            <div
                className="rounded-xl overflow-hidden divide-y mb-6"
                style={{ background: 'oklch(0.08 0.025 280)', border: '1px solid oklch(0.68 0.28 285 / 0.15)' }}
            >
                <div
                    className="grid grid-cols-2 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'oklch(0.12 0.04 280)', color: 'oklch(0.60 0.08 285)' }}
                >
                    <span>Query</span><span>Returns</span>
                </div>
                {[
                    ['allBlogPost', 'Every BlogPost node'],
                    ['blogPost(id, slug, title, …)', 'First node matching all supplied args'],
                ].map(([q, r]) => (
                    <div key={q} className="grid grid-cols-2 gap-4 px-4 py-3 text-sm">
                        <code className="text-primary text-xs">{q}</code>
                        <span className="text-muted-foreground">{r}</span>
                    </div>
                ))}
            </div>
            <p className="text-muted-foreground mb-4">
                Scalar fields are automatically added as lookup arguments on the single-item
                query — so you can do {c('blogPost(slug: "hello")')} without knowing the hashed node id.
            </p>
            <Code lang="graphql">{`
# Explore your schema at /__hadars/graphql in dev mode
{
    allBlogPost {
        id
        slug
        title
        date
    }

    blogPost(slug: "hello-world") {
        title
        body
    }
}
            `}</Code>

            <h3 className="text-lg font-semibold mb-3 mt-8 text-gradient-soft">useGraphQL hook</h3>
            <p className="text-muted-foreground mb-4">
                Query your GraphQL layer directly inside any component — no need to thread data
                through {c('getInitProps')}. The hook integrates with {c('useServerData')} so queries
                run on the server during static export and hydrate on the client at no extra cost.
            </p>
            <Code lang="tsx">{`
import { useGraphQL } from 'hadars';
import { GetAllPostsDocument } from './gql/graphql';

const PostList = () => {
    const result = useGraphQL(GetAllPostsDocument);
    const posts = result?.data?.allBlogPost ?? [];
    return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
};
            `}</Code>
            <p className="text-muted-foreground mt-4 mb-4">
                Pass variables as a second argument. When a typed {c('DocumentNode')} from
                graphql-codegen is used, {c('result.data')} has the exact inferred shape of your query
                — no casting needed.
            </p>
            <Code lang="tsx">{`
const PostPage = ({ slug }: { slug: string }) => {
    const result = useGraphQL(GetPostDocument, { slug });
    const post = result?.data?.blogPost;
    if (!post) return null;
    return <h1>{post.title}</h1>;
};
            `}</Code>
            <p className="text-muted-foreground mt-4">
                {c('result')} is {c('undefined')} on the first SSR pass while the query is
                pending — render {c('null')} or a skeleton. GraphQL errors throw during static
                export so the page is marked as failed rather than silently serving incomplete data.
            </p>

            <h3 className="text-lg font-semibold mb-3 mt-8 text-gradient-soft">GraphQL fragments</h3>
            <p className="text-muted-foreground mb-4">
                graphql-codegen's {c('client')} preset generates fragment masking helpers
                ({c('FragmentType')}, {c('useFragment')}) that let components co-locate their exact
                data requirements. No hadars changes are needed — just define your fragment with
                the {c('graphql()')} tag and accept a masked prop:
            </p>
            <Code lang="tsx">{`
// src/PostCard.tsx
import { graphql, useFragment, type FragmentType } from './gql';

export const PostCardFragment = graphql(\`
    fragment PostCard on BlogPost {
        slug
        title
        date
    }
\`);

interface Props { post: FragmentType<typeof PostCardFragment> }

const PostCard = ({ post: postRef }: Props) => {
    const post = useFragment(PostCardFragment, postRef);
    return (
        <article>
            <h2>{post.title}</h2>
            <time>{post.date}</time>
        </article>
    );
};
            `}</Code>
            <p className="text-muted-foreground mt-4 mb-4">
                The parent component spreads the raw node into the masked prop — TypeScript ensures
                it satisfies the fragment shape without any manual type assertions:
            </p>
            <Code lang="tsx">{`
const PostList = () => {
    const result = useGraphQL(GetAllPostsDocument);
    return (
        <>
            {result?.data?.allBlogPost.map(post => (
                <PostCard key={post.slug} post={post} />
            ))}
        </>
    );
};
            `}</Code>

            <h3 className="text-lg font-semibold mb-3 mt-8 text-gradient-soft">Schema export &amp; type generation</h3>
            <p className="text-muted-foreground mb-4">
                Run {c('hadars export schema')} to write the inferred schema to a SDL file, then use
                {' '}<strong>graphql-codegen</strong> to generate TypeScript types for your queries.
                Also works with a custom {c('graphql')} executor — hadars introspects it automatically.
            </p>
            <Code lang="bash">{`
# 1. Generate schema.graphql from your sources
hadars export schema

# Custom output path
hadars export schema types/schema.graphql

# 2. Install codegen (one-time)
npm install -D @graphql-codegen/cli @graphql-codegen/typescript @graphql-codegen/typescript-operations

# 3. Generate types
npx graphql-codegen --schema schema.graphql --documents "src/**/*.tsx" --out src/gql/
            `}</Code>
            <p className="text-muted-foreground mt-4 mb-4">
                Or add a {c('codegen.ts')} config file for more control:
            </p>
            <Code lang="typescript">{`
// codegen.ts
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
    schema: 'schema.graphql',
    documents: ['src/**/*.tsx'],
    generates: {
        'src/gql/': {
            preset: 'client',
        },
    },
};

export default config;
            `}</Code>

            <h3 className="text-lg font-semibold mb-3 mt-8 text-gradient-soft">Supported Gatsby context API</h3>
            <p className="text-muted-foreground mb-4">
                The following Gatsby {c('sourceNodes')} context properties are implemented:
            </p>
            <div
                className="rounded-xl overflow-hidden divide-y mb-4"
                style={{ background: 'oklch(0.08 0.025 280)', border: '1px solid oklch(0.68 0.28 285 / 0.15)' }}
            >
                <div
                    className="grid grid-cols-2 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'oklch(0.12 0.04 280)', color: 'oklch(0.60 0.08 285)' }}
                >
                    <span>Property</span><span>Notes</span>
                </div>
                {[
                    ['actions.createNode', 'Adds a node to the store'],
                    ['actions.deleteNode', 'No-op (not needed on initial build)'],
                    ['actions.touchNode', 'No-op'],
                    ['createNodeId(input)', 'SHA-256 of pluginName + input'],
                    ['createContentDigest(obj)', 'MD5 of JSON.stringify(obj)'],
                    ['getNode(id)', 'Look up a node by id'],
                    ['getNodes()', 'All nodes in the store'],
                    ['getNodesByType(type)', 'All nodes of a given type'],
                    ['cache.get / cache.set', 'In-memory per-plugin cache'],
                    ['reporter.info/warn/error/panic', 'Logs to console'],
                    ['emitter', 'Real EventEmitter — BOOTSTRAP_FINISHED is emitted after settling'],
                ].map(([p, n]) => (
                    <div key={p} className="grid grid-cols-2 gap-4 px-4 py-3 text-sm">
                        <code className="text-primary text-xs">{p}</code>
                        <span className="text-muted-foreground">{n}</span>
                    </div>
                ))}
            </div>

            <h3 className="text-lg font-semibold mb-3 mt-8 text-gradient-soft">Custom GraphQL executor</h3>
            <p className="text-muted-foreground mb-4">
                If you prefer to manage your own schema — or need full control over resolvers —
                skip {c('sources')} and provide a {c('graphql')} executor directly. It will be
                passed to both {c('paths()')} and {c('getInitProps()')} as {c('ctx.graphql')}.
            </p>
            <Code lang="typescript">{`
import { graphql, buildSchema } from 'graphql';
import type { HadarsOptions } from 'hadars';

const schema = buildSchema(\`
    type Post { id: ID! title: String slug: String }
    type Query { allPost: [Post!]! }
\`);

const rootValue = {
    allPost: () => fetchPostsFromDb(),
};

export default {
    entry: './src/App.tsx',

    graphql: (query, variables) =>
        graphql({ schema, rootValue, source: query, variableValues: variables }),

    paths: async ({ graphql }) => {
        const { data } = await graphql('{ allPost { slug } }');
        return ['/', ...(data?.allPost ?? []).map((p: any) => \`/post/\${p.slug}\`)];
    },
} satisfies HadarsOptions;
            `}</Code>
        </section>

        <footer className="mt-16 pt-8 text-center text-sm text-muted-foreground" style={{ borderTop: "1px solid oklch(0.68 0.28 285 / 0.15)" }}>
            <p>hadars — MIT licence</p>
        </footer>
    </>
);

export default StaticExport;
