import type { LinkHTMLAttributes, MetaHTMLAttributes, ScriptHTMLAttributes, StyleHTMLAttributes } from "react";

export type HadarsGetInitialProps<T extends {}> = (req: HadarsRequest) => Promise<T> | T;
export type HadarsGetClientProps<T extends {}> = (props: T) => Promise<T> | T;
export type HadarsGetAfterRenderProps<T extends {}> = (props: HadarsProps<T>, html: string) => Promise<HadarsProps<T>> | HadarsProps<T>;
export type HadarsGetFinalProps<T extends {}> = (props: HadarsProps<T>) => Promise<T> | T;
export type HadarsApp<T extends {}> = React.FC<HadarsProps<T>>;

export type HadarsEntryModule<T extends {}> = {
    default: HadarsApp<T>;
    getInitProps?: HadarsGetInitialProps<T>;
    getAfterRenderProps?: HadarsGetAfterRenderProps<T>;
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
    | { status: 'suspense-resolved' }
    | { status: 'suspense-cached'; value: unknown }
    | { status: 'rejected'; reason: unknown };

/** @internal Populated by the framework's render loop — use useServerData() instead. */
export interface AppUnsuspend {
    cache: Map<string, UnsuspendEntry>;
    hasPending: boolean;
}

export interface AppContext {
    path?: string;
    head: AppHead;
    /** @internal Framework use only — use the useServerData() hook instead. */
    _unsuspend?: AppUnsuspend;
}

export type HadarsEntryBase = {
    location: string;
    context: AppContext;
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
