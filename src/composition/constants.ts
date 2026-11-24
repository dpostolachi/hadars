/** Where a host publishes the packages modules import instead of bundling. */
export const SHARED_GLOBAL = '__HADARS_SHARED__';
/** Where a client bundle registers its exports. */
export const MODULES_GLOBAL = '__HADARS_MODULES__';

export const DEFAULT_SHARED = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

export interface TargetManifest {
    js: string[];
    css: string[];
}
