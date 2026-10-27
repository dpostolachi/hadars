import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assembleLockfile, createBuild } from '../src/composition/artifacts';
import { pinExportShell } from '../src/composition/exportShell';

test('export shell file selection and native contract preserve module and library pins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'export-shell-'));
    const write = (file: string, bytes: string) => { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), bytes); };
    try {
        write('source/client/entry.js', 'earlier');
        write('source/server/entry.js', 'earlier server');
        const options = { sourceDir: join(dir, 'source'), buildsDir: join(dir, 'builds'), targets: {
            client: { js: ['client/entry.js'], css: [] }, server: { js: ['server/entry.js'], css: [] } } };
        const shell = createBuild({ ...options, kind: 'shell', name: 'shell', provides: { shared: '1.2.3' }, runtimeContract: '2' }).manifest;
        const module = createBuild({ ...options, kind: 'module', name: 'module', requires: { shared: '^1' }, runtimeContract: '2' }).manifest;
        const library = createBuild({ ...options, kind: 'library', name: 'library', runtimeContract: '2' }).manifest;
        const initial = assembleLockfile({ shell, modules: [module], libraries: [library] });
        for (const [file, bytes] of Object.entries({
            '.hadars/index.ssr.js': 'final server', '.hadars/extra.ssr.js': 'server chunk', '.hadars/index.ssr.css': 'server css',
            '.hadars/unrelated.js': 'excluded', '.hadars/static/index.js': 'final client', '.hadars/static/out.html': 'html',
            '.hadars/static/images/asset.svg': 'image', '.hadars/static/_builds/old/client.js': 'excluded',
            '.hadars/static/composition-provenance.json': 'excluded',
        })) write(file, bytes);
        const { lock } = pinExportShell(dir, initial, join(dir, 'builds'));
        const manifest = lock.builds[lock.snapshot.shell]!.manifest;
        expect(manifest.buildId).not.toBe(shell.buildId);
        expect(manifest.provides).toEqual(shell.provides);
        expect(manifest.runtimeContract).toBe('2');
        expect(lock.snapshot.modules).toEqual(initial.snapshot.modules);
        expect(lock.snapshot.libraries).toEqual(initial.snapshot.libraries);
        expect(lock.builds[module.buildId]).toEqual(initial.builds[module.buildId]);
        expect(lock.builds[library.buildId]).toEqual(initial.builds[library.buildId]);
        expect(manifest.files.map(f => f.path)).toEqual(['client/images/asset.svg', 'client/index.js', 'client/out.html', 'server/extra.ssr.js', 'server/index.ssr.css', 'server/index.ssr.js']);
        expect(readFileSync(join(dir, 'shell/artifact/server/extra.ssr.js'), 'utf8')).toBe('server chunk');
        expect(JSON.parse(readFileSync(join(dir, 'hadars.lock'), 'utf8'))).toEqual(lock);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
