import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeExport, verifyExport } from '../src/composition/build';
import { hash } from '../src/composition/identity';
import { runCli } from '../cli-lib';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'export-integrity-'));
    dirs.push(dir);
    const staticDir = join(dir, 'static');
    mkdirSync(join(staticDir, 'nested'), { recursive: true });
    writeFileSync(join(dir, 'entry.mjs'), 'export default 1;');
    writeFileSync(join(staticDir, 'nested/asset.js'), 'asset');
    writeFileSync(join(staticDir, 'out.html'), '<html/>');
    const metadata = join(staticDir, 'composition-provenance.json');
    writeFileSync(metadata, JSON.stringify({ snapshot: 'snapshot', shell: 'shell', modules: {} }));
    const output = finalizeExport(dir, join(dir, 'entry.mjs'), staticDir);
    return { dir, staticDir, metadata, output, verify: () => verifyExport(dir, 'static/composition-provenance.json') };
}

test('completed export verifies through public helper and CLI with a deterministic inventory', async () => {
    const f = fixture();
    expect(f.verify()).toEqual(f.output);
    expect(f.output.static.files.map(file => file.path)).toEqual(['nested/asset.js', 'out.html']);
    expect(f.output.static.sha256).toBe(hash(JSON.stringify(f.output.static.files.map(file => [file.path, file.sha256, file.size]))));
    expect(finalizeExport(f.dir, join(f.dir, 'entry.mjs'), f.staticDir)).toEqual(f.output);
    await runCli(['runtime', 'cli', 'composition', 'verify-export', f.dir, 'static/composition-provenance.json', f.output.metadataSha256]);
    expect(() => verifyExport(f.dir, 'static/composition-provenance.json', '0'.repeat(64))).toThrow('metadata checksum mismatch');
});

for (const [name, file, message] of [
    ['entry', 'entry.mjs', 'Entry script changed: entry.mjs'],
    ['nested asset', 'static/nested/asset.js', 'Static hash mismatch: nested/asset.js'],
    ['template', 'static/out.html', 'Static hash mismatch: out.html'],
] as const) test(`changing one byte in ${name} fails verification`, () => {
    const f = fixture();
    const bytes = readFileSync(join(f.dir, file));
    bytes[0] = bytes[0]! ^ 1;
    writeFileSync(join(f.dir, file), bytes);
    expect(f.verify).toThrow(message);
});

test('missing and extra static files report exact paths together', () => {
    const f = fixture();
    rmSync(join(f.staticDir, 'nested/asset.js'));
    writeFileSync(join(f.staticDir, 'extra.txt'), 'extra');
    expect(f.verify).toThrow('Missing static file: nested/asset.js');
    expect(f.verify).toThrow('Extra static file: extra.txt');
});

test('missing script is distinguished from changed script', () => {
    const f = fixture();
    rmSync(join(f.dir, 'entry.mjs'));
    expect(f.verify).toThrow('Missing entry script: entry.mjs');
});

for (const field of ['snapshot', 'shell', 'modules', 'output']) test(`editing metadata ${field} fails verification`, () => {
    const f = fixture();
    const metadata = JSON.parse(readFileSync(f.metadata, 'utf8'));
    if (field === 'output') metadata.output.entry.sha256 = '0'.repeat(64);
    else metadata[field] = 'changed';
    writeFileSync(f.metadata, JSON.stringify(metadata));
    expect(f.verify).toThrow('metadata checksum mismatch');
});

test('old and malformed metadata cannot silently pass', () => {
    const f = fixture();
    writeFileSync(f.metadata, '{}');
    expect(f.verify).toThrow('missing or unsupported output version');
    writeFileSync(f.metadata, '{');
    expect(f.verify).toThrow('Export metadata unreadable');
});

test('symlinked static files fail verification', () => {
    const f = fixture();
    symlinkSync(join(f.dir, 'entry.mjs'), join(f.staticDir, 'alias'));
    expect(f.verify).toThrow('Symlink build file: alias');
});
