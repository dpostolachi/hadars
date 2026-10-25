import type { TargetManifest } from './constants';

const loadedAt = new Map<string, number>();

/**
 * Server side: loads a built module's server bundle. The host must have called
 * `provideShared` first. `dir` is the target directory written by `buildModule`
 * (`<outDir>/server`).
 *
 * A bundle whose file changed since it was last loaded is evaluated again, so
 * a dev rebuild shows up on the next request; an unchanged one stays cached.
 */
export async function loadServerModule(source: string | { dir: string; manifest: TargetManifest }): Promise<any> {
    const [{ readFile, stat }, { createRequire }, path] = await Promise.all([
        import(/* webpackIgnore: true */ 'node:fs/promises'),
        import(/* webpackIgnore: true */ 'node:module'),
        import(/* webpackIgnore: true */ 'node:path'),
    ]);
    const dir = typeof source === 'string' ? source : source.dir;
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest: TargetManifest = typeof source === 'string' ? JSON.parse(await readFile(manifestPath, 'utf8')) : source.manifest;
    const file = manifest.js[0];
    if (!file) throw new Error(`No server bundle listed in ${manifestPath}`);
    const full = path.join(dir, file);
    const { mtimeMs } = await stat(full);
    const req = createRequire(full);
    // ESM import() would share CommonJS's cache, so evict it explicitly.
    if (loadedAt.get(full) !== mtimeMs) {
        delete req.cache[full];
        loadedAt.set(full, mtimeMs);
    }
    // A dev rebuild writes the file in place, so a request can catch it half written. That fails
    // to parse (the error type differs by runtime) or the file changes under us; both clear on re-read.
    let seen = mtimeMs;
    for (let attempt = 0; ; attempt++) {
        try {
            return req(full);
        } catch (err: any) {
            const now = (await stat(full)).mtimeMs;
            const moved = now !== seen;
            const parseError = ['SyntaxError', 'BuildMessage'].includes(err?.name) || /unexpected end|found end of file/i.test(String(err?.message));
            if (attempt >= 4 || !(moved || parseError)) throw err;
            seen = now;
            delete req.cache[full];
            loadedAt.set(full, now);
            await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        }
    }
}

