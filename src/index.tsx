export type {
    HadarsOptions,
    HadarsProps,
    HadarsRequest,
    HadarsGetFinalProps,
    HadarsGetInitialProps,
    HadarsGetClientProps,
    HadarsEntryModule,
    HadarsApp,
    HadarsStaticContext,
    GraphQLExecutor,
    HadarsSourceEntry,
    HadarsDocumentNode,
} from "./types/hadars";
export { Head as HadarsHead, useServerData, useGraphQL, initServerDataCache } from './utils/Head';

/**
 * Dynamically loads a module with target-aware behaviour:
 *
 * - **Browser** (after loader transform): becomes `import('./path')`, which
 *   rspack splits into a separate chunk for true code splitting.
 * - **SSR** (after loader transform): becomes
 *   `Promise.resolve(require('./path'))`, which rspack bundles statically.
 *
 * The hadars rspack loader must be active for the transform to apply.
 * **The path argument must be a string literal** at the `loadModule()` call
 * site — passing a variable prevents the loader from transforming the call,
 * so the module is not bundled and build-time transforms (SWC plugins, etc.)
 * are never applied.
 *
 * @example
 * // Correct — literal path at call site:
 * const MyComp = React.lazy(() => loadModule('./MyComp'));
 *
 * // Also correct — wrapper receives the factory, not the path string:
 * const lazy = (fn: () => Promise<{ default: React.FC }>) => React.lazy(fn);
 * const MyComp = lazy(() => loadModule('./MyComp'));
 */
export function loadModule<T = any>(path: string): Promise<T> {
    // webpackIgnore suppresses rspack's "critical dependency" warning for the
    // variable import. This body is a fallback only — the hadars loader
    // transforms every loadModule('./...') call site at compile time, so this
    // function is never invoked in a bundled build.
    return import(/* webpackIgnore: true */ path) as Promise<T>;
}