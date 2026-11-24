import { splitStatic } from './split';
import { createHash } from 'node:crypto';
import type { Artifact } from './index';
export const safeStaticPath = (path: string): boolean => typeof path === 'string' && !!path && !/[\\?#\x00-\x1f]/.test(path) && !path.split('/').some(p => !p || p === '.' || p === '..');
/** Deliberately conservative: a dot-delimited digest, not an arbitrary hex-looking filename. */
export const hashedShellPath = (path: string) => safeStaticPath(path) && (!path.includes('/') || path.startsWith('discovery/') && path.split('/').length === 2) && /\.[a-f0-9]{8,64}\.[a-z0-9]+$/i.test(path);
export const managedStaticPath = (path: string) => safeStaticPath(path) && (/^_builds\/[a-f0-9]+\/client\/.+/.test(path) || /^_shell\/[a-f0-9]{64}\/.+/.test(path) || hashedShellPath(path) && !path.startsWith('_'));
export function staticLayout(artifact: Artifact) {
    // Native shell source identity does not identify the final export: module pins also affect it.
    const digest = createHash('sha256');
    for (const f of [...artifact.files].sort((a, b) => a.path.localeCompare(b.path))) digest.update(JSON.stringify([f.path, createHash('sha256').update(f.bytes).digest('hex')]));
    const shellBuildId = digest.digest('hex');
    const files = artifact.files.filter(f => artifact.files.some(a => a.role === 'manifest' || a.path === '.hadars/split-manifest.json') ? splitStatic(f) : f.path !== artifact.entry).map(f => {
        if (!safeStaticPath(f.path)) throw new Error('Invalid static path');
        if (f.path.startsWith('_builds/')) {
            if (!/^_builds\/[a-f0-9]+\/client\/.+/.test(f.path)) throw new Error('Invalid module client path');
            return { ...f };
        }
        if (f.path.startsWith('_shell/')) throw new Error('Reserved shell layout prefix');
        return { ...f, path: hashedShellPath(f.path) ? f.path : `_shell/${shellBuildId}/${f.path}` };
    });
    // The deploy tool cannot safely rewrite producer JS/HTML or its integrity metadata.
    for (const f of artifact.files.filter(f => f.path.endsWith('.html'))) {
        const text = new TextDecoder().decode(f.bytes);
        for (const marker of text.matchAll(/name=["']HADARS_ASSET_BASE["'] content=["']([^"']+)["']/g)) {
            const metadata = JSON.parse(decodeURIComponent(marker[1]!));
            if (!Array.isArray(metadata.files) || metadata.files.some((p: string) => !hashedShellPath(p))) throw new Error('Runtime asset metadata references stable shell paths; producer must emit hashed assets');
        }
    }
    return { shellBuildId, files, paths: files.map(f => f.path).sort() };
}
