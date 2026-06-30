import { readFile } from 'node:fs/promises';

/** MIME type map keyed by lowercase file extension. */
const MIME: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css',
    js: 'application/javascript',
    mjs: 'application/javascript',
    cjs: 'application/javascript',
    json: 'application/json',
    map: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    txt: 'text/plain',
    xml: 'application/xml',
    pdf: 'application/pdf',
};

/**
 * Tries to serve a file at the given absolute path.
 * Returns a Response with the correct Content-Type, or null if the file does
 * not exist or cannot be read.
 */
export async function tryServeFile(filePath: string): Promise<Response | null> {
    try {
        const data = await readFile(filePath);
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        const contentType = MIME[ext] ?? 'application/octet-stream';
        return new Response(data as BodyInit, { headers: { 'Content-Type': contentType } });
    } catch {
        return null;
    }
}

/**
 * Negative-result cache for {@link tryServeFileCached}.
 * Paths that returned null are stored here so subsequent requests skip the
 * readFile syscall entirely. Static assets never appear at runtime, so
 * caching misses is safe for the lifetime of the process.
 *
 * Capped at 50 000 entries to prevent unbounded growth on servers that
 * receive many unique dynamic-route paths (e.g. /post/[slug]).
 */
const _notFound = new Set<string>();
const _NOT_FOUND_MAX = 50_000;

/**
 * Like {@link tryServeFile} but caches negative results so that paths which
 * don't exist (e.g. every SSR route tried against the static directory) only
 * pay the readFile cost once.
 */
export async function tryServeFileCached(filePath: string): Promise<Response | null> {
    if (_notFound.has(filePath)) return null;
    const res = await tryServeFile(filePath);
    if (!res && _notFound.size < _NOT_FOUND_MAX) _notFound.add(filePath);
    return res;
}
