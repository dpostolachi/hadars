import type { LinkHTMLAttributes, MetaHTMLAttributes, ScriptHTMLAttributes, StyleHTMLAttributes } from "react";

/**
 * In-process GraphQL executor passed to `getInitProps` and `paths` during
 * `hadars export static`. Hadars is executor-agnostic — configure it in
 * `hadars.config.ts` using any GraphQL library (e.g. `graphql-js`):
 *
 * ```ts
 * import { graphql as gql, buildSchema } from 'graphql';
 * const schema = buildSchema(`type Query { hello: String }`);
 * const rootValue = { hello: () => 'world' };
 *
 * export default {
 *   graphql: (query, variables) =>
 *     gql({ schema, rootValue, source: query, variableValues: variables }),
 * } satisfies HadarsOptions;
 * ```
 */
export type GraphQLExecutor = (
    query: string,
    variables?: Record<string, unknown>,
) => Promise<{ data?: any; errors?: ReadonlyArray<{ message: string }> }>;

/**
 * Context passed as the second argument to `getInitProps` and `paths`
 * during `hadars export static`. Not present in dev/run mode.
 */
export interface HadarsStaticContext {
    graphql: GraphQLExecutor;
}

export type HadarsGetInitialProps<T extends {}> = (req: HadarsRequest, ctx?: HadarsStaticContext) => Promise<T> | T;
export type HadarsGetClientProps<T extends {}> = (props: T) => Promise<T> | T;
export type HadarsGetFinalProps<T extends {}> = (props: HadarsProps<T>) => Promise<T> | T;
export type HadarsApp<T extends {}> = React.FC<HadarsProps<T>>;

export type HadarsEntryModule<T extends {}> = {
    default: HadarsApp<T>;
    getInitProps?: HadarsGetInitialProps<T>;
    getFinalProps?: HadarsGetFinalProps<T>;
    getClientProps?: HadarsGetClientProps<T>;
}

export interface AppHead {
    title: string;
    status: number;
    meta: Record<string, MetaProps>;
    link: Record<string, LinkProps>;
    style: Record<string, StyleProps>;
    script: Record<string, ScriptProps>;
}

export type UnsuspendEntry =
    | { status: 'pending'; promise: Promise<unknown> }
    | { status: 'fulfilled'; value: unknown }
    | { status: 'rejected'; reason: unknown };

/** @internal Populated by the framework's render loop — use useServerData() instead. */
export interface AppUnsuspend {
    cache: Map<string, UnsuspendEntry>;
}

export interface AppContext {
    path?: string;
    head: AppHead;
    /** @internal Framework use only — use the useServerData() hook instead. */
    _unsuspend?: AppUnsuspend;
}

export type HadarsEntryBase = {
    location: string;
}

export type HadarsProps<T extends {}> = T & HadarsEntryBase;

export type MetaProps = MetaHTMLAttributes<HTMLMetaElement>;
export type LinkProps = LinkHTMLAttributes<HTMLLinkElement>;
export type StyleProps = StyleHTMLAttributes<HTMLStyleElement>;
export type ScriptProps = ScriptHTMLAttributes<HTMLScriptElement>;

export interface HadarsOptions {
    port?: number;
    entry: string;
    baseURL?: string;
    // Optional SWC plugins to be applied to the swc-loader during compilation
    swcPlugins?: SwcPluginList;
    proxy?: Record<string, string> | ((req: HadarsRequest) => Promise<Response | null> | Response | null);
    proxyCORS?: boolean;
    define?: Record<string, string>;
    /**
     * Bun WebSocket handler passed directly to `Bun.serve()`.
     * Ignored on Node.js and Deno — use `fetch` + a third-party WS library there.
     * Pass a `Bun.WebSocketHandler` instance here when running on Bun.
     */
    websocket?: unknown;
    fetch?: (req: HadarsRequest) => Promise<Response | undefined> | Response | undefined;
    wsPath?: string;
    // Port for the rspack HMR dev server. Defaults to port + 1.
    hmrPort?: number;
    /**
     * Parallelism level for `run()` mode (production server). Defaults to 1.
     * Has no effect in `dev()` mode.
     *
     * **Node.js** — forks this many worker processes via `node:cluster`, each
     * binding to the same port via OS round-robin. Set to `os.cpus().length`
     * to saturate all CPU cores.
     *
     * **Bun / Deno** — creates a `node:worker_threads` render pool of this size.
     * Each thread handles the synchronous `renderToString` step, freeing the
     * main event loop for I/O.
     */
    workers?: number;
    /**
     * Override or extend rspack's `optimization` config for production client builds.
     * Merged on top of hadars defaults (splitChunks vendor splitting, deterministic moduleIds).
     * Has no effect on the SSR bundle or dev mode.
     */
    optimization?: Record<string, unknown>;
    /**
     * PostCSS plugins to pass to `postcss-loader`.
     *
     * When set, replaces the default `builtin:lightningcss-loader` with `postcss-loader`
     * configured with these plugins, allowing full PostCSS transforms (e.g. Tailwind CSS v4).
     *
     * @example
     * ```ts
     * import tailwindcss from '@tailwindcss/postcss';
     * export default { postcssPlugins: [tailwindcss()] } satisfies HadarsOptions;
     * ```
     */
    postcssPlugins?: any[];
    /**
     * Path to a custom HTML template file (relative to the project root).
     * Replaces the built-in minimal template used to generate the HTML shell.
     *
     * The file must include two marker elements so hadars can inject the
     * per-request head tags and the server-rendered body:
     *
     * ```html
     * <meta name="HADARS_HEAD">   <!-- replaced with <title>, <meta>, <link>, <style> tags -->
     * <meta name="HADARS_BODY">   <!-- replaced with the SSR-rendered React tree -->
     * ```
     *
     * Any `<style>` blocks in the template are automatically processed through
     * PostCSS (using the project's `postcss.config.js`) at build/dev startup time,
     * so `@import "tailwindcss"` and other PostCSS directives work as expected.
     * Note: inline styles are processed once at startup and are not live-reloaded.
     */
    htmlTemplate?: string;
    /**
     * Force the React runtime mode independently of the build mode.
     * Useful when you need production build optimizations (minification, tree-shaking)
     * but want React's development build for debugging hydration mismatches or
     * component stack traces.
     *
     * - `'development'` — forces `process.env.NODE_ENV = "development"` and enables
     *   JSX source info even in `hadars build`. React prints detailed hydration error
     *   messages and component stacks.
     * - `'production'` — the default; React uses the optimised production bundle.
     *
     * Only affects the **client** bundle. The SSR bundle always uses slim-react.
     *
     * @example
     * // hadars.config.ts — debug hydration errors in a production build
     * reactMode: 'development'
     */
    reactMode?: 'development' | 'production';
    /**
     * Additional rspack module rules appended to the built-in rule set.
     * Applied to both the client and the SSR bundle.
     *
     * Useful for loaders not included by default, such as `@mdx-js/loader`,
     * `less-loader`, `yaml-loader`, etc.
     *
     * @example
     * moduleRules: [
     *   {
     *     test: /\.mdx?$/,
     *     use: [{ loader: '@mdx-js/loader' }],
     *   },
     * ]
     */
    moduleRules?: Record<string, any>[];
    /**
     * Additional rspack/webpack-compatible plugins applied to both the client
     * and SSR bundles. Any object that implements the `apply(compiler)` method
     * (the standard webpack/rspack plugin interface) is accepted.
     *
     * @example
     * import { SubresourceIntegrityPlugin } from 'webpack-subresource-integrity';
     * plugins: [new SubresourceIntegrityPlugin()]
     */
    plugins?: Array<{ apply(compiler: any): void }>;
    /**
     * SSR response cache for `run()` mode. Has no effect in `dev()` mode.
     *
     * Receives the incoming request and should return `{ key, ttl? }` to cache
     * the response, or `null`/`undefined` to skip caching for that request.
     * `ttl` is the time-to-live in milliseconds; omit for entries that never expire.
     * The function may be async.
     *
     * @example
     * // Cache every page by pathname (no per-user personalisation):
     * cache: (req) => ({ key: req.pathname })
     *
     * @example
     * // Cache with a per-route TTL, skip authenticated requests:
     * cache: (req) => req.cookies.session ? null : { key: req.pathname, ttl: 60_000 }
     */
    cache?: (req: HadarsRequest) => { key: string; ttl?: number } | null | undefined
                                  | Promise<{ key: string; ttl?: number } | null | undefined>;
    /**
     * Static export path list. Required for `hadars export static`.
     *
     * Return an array of URL paths (e.g. `['/', '/about', '/blog/hello']`) that
     * should be pre-rendered to HTML files. May be async.
     *
     * @example
     * paths: () => ['/', '/about', '/contact']
     *
     * @example
     * paths: async () => {
     *   const posts = await fetchBlogPosts();
     *   return ['/', ...posts.map(p => `/blog/${p.slug}`)];
     * }
     */
    /**
     * In-process GraphQL executor. Supply this to use the GraphQL data layer
     * in `paths` and `getInitProps` during `hadars export static`.
     * Has no effect in `dev` / `run` mode.
     */
    graphql?: GraphQLExecutor;
    paths?: (ctx: HadarsStaticContext) => Promise<string[]> | string[];
    /**
     * Gatsby-compatible source plugins to run before `hadars export static`.
     *
     * Each entry mirrors Gatsby's `gatsby-config.js` plugin object format:
     * `{ resolve: 'gatsby-source-contentful', options: { spaceId: '...', accessToken: '...' } }`
     *
     * The plugin must export a `sourceNodes` function with the standard Gatsby API.
     * Hadars provides a thin shim covering the most-used surface:
     * `actions.createNode`, `createNodeId`, `createContentDigest`, `cache`, `reporter`,
     * `getNode`, `getNodes`, `getNodesByType`.
     *
     * After all sources have run, hadars auto-generates a GraphQL schema from the
     * collected nodes and makes it available via `config.graphql` in `getInitProps`
     * and `paths`. Requires `graphql` to be installed in the project.
     *
     * @example
     * sources: [
     *   {
     *     resolve: 'gatsby-source-filesystem',
     *     options: { name: 'posts', path: './content/posts' },
     *   },
     * ]
     */
    sources?: HadarsSourceEntry[];
}

/**
 * A Gatsby-compatible source plugin entry, matching the format used in
 * `gatsby-config.js` / `gatsby-config.ts`.
 */
export interface HadarsSourceEntry {
    /**
     * Package name (e.g. `'gatsby-source-contentful'`) or a pre-imported module
     * object that exports `sourceNodes`. Using a module object lets you pass
     * local source plugins without publishing them to npm.
     */
    resolve: string | { sourceNodes?: (ctx: any, opts?: any) => Promise<void> | void };
    /** Plugin options forwarded as the second argument to `sourceNodes`. */
    options?: Record<string, unknown>;
}


// SWC plugin typing — a pragmatic, ergonomic union that matches common usages:
// - a plugin package name (string)
// - a tuple [pluginName, options]
// - an object with a path and optional options
// - a direct function (for programmatic plugin instances)
export type SwcPluginItem =
    | string
    | [string, Record<string, unknown>]
    | { path: string; options?: Record<string, unknown> }
    | ((...args: any[]) => any);

export type SwcPluginList = SwcPluginItem[];

export interface HadarsRequest extends Request {
    pathname: string;
    search: string;
    location: string;
    cookies: Record<string, string>;
}
