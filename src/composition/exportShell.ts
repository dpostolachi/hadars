import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assembleLockfile, createShellBuild, type BuildManifest } from './artifacts';

/** Pin the compile used by export: top-level SSR JS/CSS and the static tree,
 * excluding module assets and assembly provenance (which depends on this identity).
 */
export function pinExportShell(directory: string, lock: ReturnType<typeof assembleLockfile>, buildsDir: string, emit = true) {
    const compiled = path.join(directory, '.hadars');
    const staging = mkdtempSync(path.join(compiled, '.shell-'));
    try {
        mkdirSync(path.join(staging, 'server'));
        for (const name of readdirSync(compiled)) if (/^.+\.ssr\.(js|css)$/.test(name)) {
            cpSync(path.join(compiled, name), path.join(staging, 'server', name));
        }
        cpSync(path.join(compiled, 'static'), path.join(staging, 'client'), { recursive: true,
            filter: source => !['_builds', 'composition-provenance.json'].includes(path.basename(source)) });
        const previous = lock.builds[lock.snapshot.shell]!.manifest;
        const entries = (target: string, ext: string) => readdirSync(path.join(staging, target)).filter(p => p.endsWith(ext)).sort().map(p => `${target}/${p}`);
        const shell = createShellBuild({ sourceDir: staging, buildsDir, name: previous.name, provides: previous.provides,
            runtimeContract: previous.runtimeContract as '1' | '2', flavour: 'production', shared: previous.shared,
            exposes: previous.exposes, requires: previous.requires,
            targets: { client: { js: entries('client', '.js'), css: entries('client', '.css') },
                server: { js: ['server/index.ssr.js'], css: entries('server', '.css') } } });
        const manifests = (pins: Record<string, string>): BuildManifest[] => Object.values(pins).map(id => lock.builds[id]!.manifest);
        const finalLock = assembleLockfile({ shell: shell.manifest, modules: manifests(lock.snapshot.modules), libraries: manifests(lock.snapshot.libraries) });
        const lockFile = path.join(compiled, 'export.lock.json');
        writeFileSync(lockFile, JSON.stringify(finalLock, null, 2) + '\n');
        rmSync(path.join(directory, 'shell'), { recursive: true, force: true });
        if (emit) {
            cpSync(shell.dir, path.join(directory, 'shell/artifact'), { recursive: true });
            writeFileSync(path.join(directory, 'shell/manifest.json'), JSON.stringify(shell.manifest, null, 2) + '\n');
            writeFileSync(path.join(directory, 'hadars.lock'), readFileSync(lockFile));
        }
        return { lock: finalLock, lockFile };
    } finally { rmSync(staging, { recursive: true, force: true }); }
}
