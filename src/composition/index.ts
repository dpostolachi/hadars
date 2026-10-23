// Runtime helpers for a shell. Safe to import from an app entry that is also
// bundled for the browser; the build tooling lives in `hadars/composition/build`.
export { SHARED_GLOBAL, MODULES_GLOBAL, DEFAULT_SHARED } from './constants';
export type { TargetManifest } from './constants';
export { provideShared } from './provideShared';
export { registerModule, useModule } from './registry';
export { loadServerModule, loadClientModule } from './loadModule';
