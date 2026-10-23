import { createRequire } from 'node:module';
import { SHARED_GLOBAL } from './constants';

/**
 * Appended to a shell's dev client entry. Locally run modules hot-update through
 * the one React refresh runtime that hooked into react-dom, so the shell
 * publishes that instance. It is resolved the way @rspack/plugin-react-refresh
 * resolves it, so both are the same module in the bundle.
 */
export function shellDevSnippet(): string {
    // ReactRefreshPlugin does not run under NODE_ENV=production, and the refresh runtime throws if
    // loaded there. Read the variable indirectly so a bundler cannot constant-fold the check.
    if (process.env['NODE' + '_ENV'] === 'production') return '';
    const fromPlugin = createRequire(createRequire(import.meta.url).resolve('@rspack/plugin-react-refresh'));
    const runtime = fromPlugin.resolve('react-refresh/runtime');
    return `
;(globalThis as any).${SHARED_GLOBAL} = { ...(globalThis as any).${SHARED_GLOBAL}, 'react-refresh/runtime': require(${JSON.stringify(runtime)}) };
`;
}
