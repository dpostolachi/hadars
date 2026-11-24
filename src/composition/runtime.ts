// Filesystem-free entry for browser and edge shells.
export { SHARED_GLOBAL, MODULES_GLOBAL, DEFAULT_SHARED } from './constants';
export type { TargetManifest } from './constants';
export { provideShared } from './provideShared';
export { registerModule, registerLinkedModule, getModule } from './registry';
export { loadClientModule } from './loadModule';
export type { LoadClientModuleOptions } from './loadModule';
export { ModuleHead } from './ModuleHead';
export type { PinnedBuild } from './pinnedTypes';
