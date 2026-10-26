import fs from 'node:fs/promises';
import path from 'node:path';
import type { HadarsOptions } from '../types/hadars';

const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

/** Clean only owned directories, retaining configured inputs even when nested in output. */
export async function cleanOutput(options: HadarsOptions, cwd = process.cwd()): Promise<void> {
    const pinned = options.composition?.role === 'shell' ? options.composition.pinned : undefined;
    const preserved = [
        ...(options.moduleOutputDirs ?? []),
        ...(pinned ? [pinned.lockFile, pinned.buildsDir,
            pinned.integrityFile ?? path.join(pinned.buildsDir, '..', 'integrity.json'),
            ...Object.values(pinned.overrides ?? {}).map((o) => path.dirname(o.serverDir))] : []),
    ].map((p) => path.resolve(cwd, p));
    const clean = async (dir: string): Promise<void> => {
        if (preserved.some((p) => contains(p, dir))) return;
        if (!preserved.some((p) => contains(dir, p))) {
            await fs.rm(dir, { recursive: true, force: true });
            return;
        }
        // Never traverse symlinks while pruning an ancestor of a preserved input.
        const stat = await fs.lstat(dir).catch((err) => { if (err.code !== 'ENOENT') throw err; });
        if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return;
        for (const entry of await fs.readdir(dir)) await clean(path.join(dir, entry));
    };
    for (const dir of ['static', '.ssr-modules']) await clean(path.resolve(cwd, '.hadars', dir));
}
