import { createRequire } from 'node:module';
import { SHARED_GLOBAL } from './constants';

/**
 * Appended to a shell's dev client entry. Locally run modules hot-update through
 * the one React refresh runtime that hooked into react-dom, so the shell
 * publishes that instance. It is resolved the way @rspack/plugin-react-refresh
 * resolves it, so both are the same module in the bundle.
 */
export function shellDevSnippet(): string {
    const fromPlugin = createRequire(createRequire(import.meta.url).resolve('@rspack/plugin-react-refresh'));
    const runtime = fromPlugin.resolve('react-refresh/runtime');
    return `
;(globalThis as any).${SHARED_GLOBAL} = { ...(globalThis as any).${SHARED_GLOBAL}, 'react-refresh/runtime': require(${JSON.stringify(runtime)}) };
`;
}
