/**
 * Rspack/webpack loader that transforms `loadModule('path')` calls based on
 * the compilation target:
 *
 *  - web  (browser): replaced with `import('./path')` — rspack treats this as
 *    a true dynamic import and splits the module into a separate chunk.
 *
 *  - node (SSR):     replaced with `Promise.resolve(require('./path'))` —
 *    rspack bundles the module statically so it is always available
 *    synchronously on the server, wrapped in Promise.resolve to keep the
 *    API shape identical to the client side.
 *
 * Example usage:
 *
 *   import { loadModule } from 'hadars';
 *
 *   // Code-split React component (wrap with React.lazy + Suspense):
 *   const MyComp = React.lazy(() => loadModule('./MyComp'));
 *
 *   // Dynamic module load:
 *   const { default: fn } = await loadModule('./heavyUtil');
 */

// Matches: loadModule('./path')
//          loadModule<SomeType>('./path')   (TypeScript generic, any complexity)
// Captures group 1 = quote char, group 2 = the module path.
// The `s` flag lets `.` span newlines so multi-line generics are handled.
const LOAD_MODULE_RE =
    /\bloadModule\s*(?:<.*?>\s*)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)/gs;

export default function loader(this: any, source: string): string {
    const isServer = this.target === 'node' || this.target === 'async-node';

    return source.replace(LOAD_MODULE_RE, (_match, quote, modulePath) => {
        if (isServer) {
            return `Promise.resolve(require(${quote}${modulePath}${quote}))`;
        } else {
            return `import(${quote}${modulePath}${quote})`;
        }
    });
}
