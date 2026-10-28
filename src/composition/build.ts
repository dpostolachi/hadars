export { buildModule } from './moduleBuild';
export type { BuildModuleOptions, ModuleBuildResult } from './moduleBuild';
export { resolvePinnedBuilds } from './pinnedBuilds';
export { loadServerModule } from './loadServerModule';
export { computeBuildId } from './identity';
export { createBuild, createModuleBuild, createShellBuild, createIntegrityMap, assembleLockfile } from './artifacts';
export type { BuildManifest, CreateBuildOptions } from './artifacts';
export { resolvePinnedBuilds as verifyLockfile } from './pinnedBuilds';
export { assemblePinnedExport } from './exportBuilds';
export { resolveModuleRequires } from './versions';
export { CompositionCompatibilityError } from './errors';
export type { CompositionCompatibilityDetails } from './errors';

export { CompositionLinkError } from './errors';

export { finalizeExport, verifyExport } from './exportIntegrity';
export type { ExportFile, ExportOutput } from './exportIntegrity';

export { routingPlan, matchGroup, splitGroups } from './split';
export type { SplitOptions, SplitManifest, SplitGroup } from './split';
export { loadManifest } from './loadManifest';
export { buildModuleFromManifest, moduleOptionsFromManifest } from './buildFromManifest';
export type { ManifestBuildOptions } from './buildFromManifest';
export { emitModuleTypes, writeShellTypes, shellTypesSource } from './moduleTypes';
export type { ModuleTypes, ModuleTypesOptions } from './moduleTypes';
