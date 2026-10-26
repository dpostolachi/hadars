import type { TargetManifest } from './constants';

export interface PinnedBuildsOptions {
    lockFile: string;
    buildsDir: string;
    /** URL prefix corresponding to buildsDir. Default: /_builds/. */
    publicBase?: string;
    /** Default: integrity.json beside buildsDir; ignored when absent. */
    integrityFile?: string;
    /** Dev only: replaces a pinned module with a running module. */
    overrides?: Record<string, { serverDir: string; clientUrl: string }>;
}

export interface PinnedBuild {
    name: string;
    kind: 'shell' | 'module' | 'library';
    clientOnly?: boolean;
    server: { dir: string; manifest: TargetManifest };
    /** Safe to return as client props; contains no local paths. */
    client: { baseUrl: string; manifest: TargetManifest; files?: string[]; integrity?: Record<string, string> };
}
