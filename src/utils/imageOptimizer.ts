import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface ImageOptimizerOptions {
    /** Pixel widths to generate per source image. Default: [640, 1280, 1920] */
    widths?: number[];
    /** Output formats. Default: ['webp'] */
    formats?: ('webp' | 'avif')[];
    /** Encoding quality 1–100. Default: 80 */
    quality?: number;
}

// Raster extensions Sharp can process. SVG is vector (no resize needed).
// GIF animation is not supported by Sharp's resize path.
const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.bmp', '.webp', '.avif']);

/**
 * Scans `srcDir` recursively for raster images and writes resized + re-encoded
 * variants under `<destDir>/_images/<rel-path>/` using Sharp.
 *
 * - Skips silently if `srcDir` does not exist.
 * - Skips a variant when the output file is already newer than the source (mtime).
 * - Prints an install hint and returns early if Sharp is not installed.
 *
 * @param srcDir  - Project `static/` directory (source images).
 * @param destDir - `.hadars/static/` in run mode, or the export output dir.
 */
export async function optimizeImages(
    srcDir: string,
    destDir: string,
    opts: ImageOptimizerOptions = {},
): Promise<void> {
    const widths = opts.widths ?? [640, 1280, 1920];
    const formats = opts.formats ?? ['webp'];
    const quality = opts.quality ?? 80;

    // Sharp is an optional peer dependency — load it lazily.
    let sharp: any;
    try {
        const mod = await import('sharp');
        sharp = mod.default ?? mod;
    } catch {
        console.warn(
            '[hadars] `images` config requires "sharp" — run: npm install sharp',
        );
        return;
    }

    if (!existsSync(srcDir)) return;

    const outBase = path.join(destDir, '_images');
    await fs.mkdir(outBase, { recursive: true });

    await processDir(srcDir, srcDir, outBase, widths, formats, quality, sharp);

    console.log(`[hadars] Image variants written to ${outBase}`);
}

async function processDir(
    baseDir: string,
    dir: string,
    outBase: string,
    widths: number[],
    formats: string[],
    quality: number,
    sharp: any,
): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            await processDir(baseDir, fullPath, outBase, widths, formats, quality, sharp);
            return;
        }
        if (!entry.isFile()) return;

        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTS.has(ext)) return;

        // rel: relative path from staticDir, e.g. "photos/hero.jpg"
        const rel = path.relative(baseDir, fullPath);
        const relNoExt = rel.slice(0, -ext.length); // e.g. "photos/hero"
        const outDir = path.join(outBase, path.dirname(rel));
        await fs.mkdir(outDir, { recursive: true });

        const baseName = path.basename(relNoExt); // e.g. "hero"

        let srcMtime = 0;
        try {
            srcMtime = (await fs.stat(fullPath)).mtimeMs;
        } catch {
            return; // source disappeared
        }

        await Promise.all(widths.flatMap(width =>
            formats.map(async (fmt) => {
                const outFile = path.join(outDir, `${baseName}-${width}.${fmt}`);

                // Skip if the variant is already up-to-date.
                try {
                    const outMtime = (await fs.stat(outFile)).mtimeMs;
                    if (outMtime >= srcMtime) return;
                } catch { /* variant doesn't exist yet — proceed */ }

                try {
                    // Sharp method name matches the format string: .webp(), .avif(), etc.
                    await (sharp(fullPath)
                        .resize({ width, withoutEnlargement: true }) as any)
                        [fmt]({ quality })
                        .toFile(outFile);
                } catch (err) {
                    console.warn(
                        `[hadars] Could not generate ${rel} → ${width}px.${fmt}:`, err,
                    );
                }
            }),
        ));
    }));
}
