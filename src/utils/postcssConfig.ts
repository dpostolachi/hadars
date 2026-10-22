import fs from 'node:fs/promises';

/**
 * Loads the project's PostCSS config, along with a fingerprint identifying it.
 *
 * `postcss-load-config` throws both for "no config here" and for "a config is
 * present but failed to load", and the two cannot be told apart by `err.code`:
 * the benign case carries no `code` at all, a missing plugin package throws
 * `ERR_MODULE_NOT_FOUND`, and a malformed config throws a `SyntaxError` with no
 * `code` either. The only reliable discriminator is the message thrown at
 * postcss-load-config/src/index.js:159, so match on that and treat everything
 * else as a real failure.
 *
 * Swallowing those failures leaves `plugins` empty, so `postcss([])` runs as a
 * passthrough and emits the template's CSS unprocessed while the build still
 * reports success. The symptom is a stylesheet with Tailwind's theme layers and
 * zero utilities, which reads as "Tailwind is broken" and sends you hunting in
 * the wrong layer entirely. A config that exists and does not load is a build
 * configuration error, so fail loudly rather than warn.
 */
export async function loadPostcssConfig(): Promise<{ plugins: any[]; fingerprint: string }> {
    let config: any;
    try {
        const { default: loadConfig } = await import('postcss-load-config' as any);
        config = await loadConfig({}, process.cwd());
    } catch (err: any) {
        if (/^No PostCSS Config found in:/.test(String(err?.message))) {
            // The only benign case — no config at all, so process without plugins.
            return { plugins: [], fingerprint: 'no-config' };
        }
        throw new Error(
            '[hadars] A PostCSS config was found but failed to load, so CSS in the HTML ' +
            'template would pass through UNPROCESSED (no Tailwind, no autoprefixer). ' +
            `Fix the config or the missing dependency it names.\nCause: ${err?.message ?? err}`,
            { cause: err },
        );
    }

    const plugins: any[] = config?.plugins ?? [];
    // The fingerprint is folded into the caller's template cache key. A processed
    // template is derived from the plugins as much as from the template's bytes,
    // so keying on the template alone means editing postcss.config.js — or
    // installing a plugin it could not resolve — leaves the stale output in place
    // and the repair looks like it did nothing.
    const names = plugins.map(p => p?.postcssPlugin ?? p?.name ?? typeof p).join(',');
    let mtime = '';
    if (config?.file) {
        try { mtime = String((await fs.stat(config.file)).mtimeMs); } catch { /* unreadable — skip */ }
    }
    return { plugins, fingerprint: `${config?.file ?? ''}|${mtime}|${names}` };
}
