import type { Dirent } from 'node:fs';
import { access, lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Artifact, ArtifactFile } from './index';

/** Reads a build output directory into the files a deploy uploads. Symlinks and unknown entries are refused. */
export async function loadArtifact(directory: string): Promise<Artifact> {
    const root = resolve(directory), files: ArtifactFile[] = [];
    for (const path of [root, join(root, '.hadars'), join(root, '.hadars/static'), join(root, 'bunny.mjs'), join(root, 'units'), join(root, '.hadars/split-manifest.json'), join(root, '.hadars/composition.json'), join(root, '.hadars/static/composition-provenance.json')]) {
        try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`Artifact contains unsupported symlink ${path}`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const exists = (path: string) => access(path).then(() => true, () => false);
    const split = await exists(join(root, '.hadars/split-manifest.json'));
    if (split) {
        files.push({ role: 'manifest', path: '.hadars/split-manifest.json', bytes: new Uint8Array(await readFile(join(root, '.hadars/split-manifest.json'))) });
        let units: Dirent[] = [];
        try { units = await readdir(join(root, 'units'), { recursive: true, withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        for (const entry of units) {
            if (entry.isDirectory()) continue;
            if (!entry.isFile()) throw new Error('Artifact contains unsupported unit entries');
            const file = join(entry.parentPath, entry.name);
            files.push({ role: 'unit', path: file.slice(root.length + 1), bytes: new Uint8Array(await readFile(file)) });
        }
    }
    if (split) {
        for (const path of ['shell', 'hadars.lock']) {
            let stat;
            try { stat = await lstat(join(root, path)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
            if (stat.isSymbolicLink()) throw new Error('Artifact contains unsupported pin symlink');
            if (path === 'shell' && !stat.isDirectory() || path === 'hadars.lock' && !stat.isFile()) throw new Error('Artifact contains unsupported pin entries');
            const paths = path === 'shell' ? (await readdir(join(root, path), { recursive: true, withFileTypes: true })).flatMap(entry => {
                if (entry.isDirectory()) return [];
                if (!entry.isFile()) throw new Error('Artifact contains unsupported pin entries');
                return [join(entry.parentPath, entry.name)];
            }) : [join(root, path)];
            for (const file of paths) files.push({ role: 'pin', path: file.slice(root.length + 1), bytes: new Uint8Array(await readFile(file)) });
        }
    }
    const scriptPath = join(root, 'bunny.mjs');
    if (!split && !await exists(scriptPath)) throw new Error('Artifact directory needs bunny.mjs');
    if (!split) files.push({ path: 'bunny.mjs', bytes: new Uint8Array(await readFile(scriptPath)) });
    const staticRoot = join(root, '.hadars/static');
    let entries: Dirent[];
    try { entries = await readdir(staticRoot, { recursive: true, withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; entries = []; }
    for (const entry of entries) {
        if (entry.isDirectory()) continue;
        if (!entry.isFile()) throw new Error('Artifact contains unsupported static entries');
        const file = join(entry.parentPath, entry.name);
        files.push({ ...(split ? { role: 'static' as const } : {}), path: file.slice(staticRoot.length + 1), bytes: new Uint8Array(await readFile(file)) });
    }
    let provenance;
    try { provenance = JSON.parse(await readFile(join(root, '.hadars/composition.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Invalid provenance .hadars/composition.json: expected JSON'); }
    let nativeProvenance;
    const nativeFile = files.find(f => f.path === 'composition-provenance.json');
    if (nativeFile) {
        try { nativeProvenance = JSON.parse(new TextDecoder().decode(nativeFile.bytes)); }
        catch { throw new Error('Invalid native provenance composition-provenance.json: expected JSON'); }
        if (!nativeProvenance || typeof nativeProvenance !== 'object' || Array.isArray(nativeProvenance)) throw new Error('Invalid native provenance composition-provenance.json: expected object');
    }
    const manifest = split ? JSON.parse(new TextDecoder().decode(files.find(f => f.path === '.hadars/split-manifest.json')!.bytes)) : undefined;
    return { provenance, nativeProvenance, entry: manifest?.groups?.find((g: any) => g.name === manifest.defaultGroup)?.unit?.file ?? 'bunny.mjs', files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}
