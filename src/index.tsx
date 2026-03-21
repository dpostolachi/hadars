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
} from "./types/hadars";
export { Head as HadarsHead, useServerData, initServerDataCache } from './utils/Head';

/**
 * Dynamically loads a module with target-aware behaviour:
 *
 * - **Browser** (after loader transform): becomes `import('./path')`, which
 *   rspack splits into a separate chunk for true code splitting.
 * - **SSR** (after loader transform): becomes
 *   `Promise.resolve(require('./path'))`, which rspack bundles statically.
 *
 * The hadars rspack loader must be active for the transform to apply.
 * This runtime fallback uses a plain dynamic import (no code splitting).
 *
 * @example
 * // Code-split React component:
 * const MyComp = React.lazy(() => loadModule('./MyComp'));
 *
 * // Dynamic data:
 * const { default: fn } = await loadModule<typeof import('./util')>('./util');
 */
export function loadModule<T = any>(path: string): Promise<T> {
    // webpackIgnore suppresses rspack's "critical dependency" warning for the
    // variable import. This body is a fallback only — the hadars loader
    // transforms every loadModule('./...') call site at compile time, so this
    // function is never invoked in a bundled build.
    return import(/* webpackIgnore: true */ path) as Promise<T>;
}