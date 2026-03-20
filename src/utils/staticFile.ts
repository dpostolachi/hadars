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
