/**
 * Server-side segment cache for CacheSegment.
 *
 * The store lives on globalThis so all module instances (framework source,
 * compiled dist, user SSR bundle) share the exact same Map regardless of
 * how `hadars` was resolved by Node's module loader.
 */

interface SegmentEntry {
    html: string;
    expiresAt: number | null;
}

function getStore(): Map<string, SegmentEntry> {
    const g = globalThis as any;
    if (!g.__hadarsSegmentStore) {
        g.__hadarsSegmentStore = new Map<string, SegmentEntry>();
    }
    return g.__hadarsSegmentStore;
}

export function getSegment(key: string): string | null {
    const entry = getStore().get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
        getStore().delete(key);
        return null;
    }
    return entry.html;
}

export function setSegment(key: string, html: string, ttl?: number): void {
    getStore().set(key, {
        html,
        expiresAt: ttl != null ? Date.now() + ttl : null,
    });
}

export function deleteSegment(key: string): void {
    getStore().delete(key);
}

export function clearSegments(): void {
    getStore().clear();
}

/**
 * Custom element name used as a boundary marker in the rendered HTML.
 * Must contain a hyphen (valid custom element). Stripped by processSegmentCache
 * before the response is sent — the browser never sees this tag.
 */
export const CACHE_TAG = 'hadars-c';

/**
 * Post-processes the HTML string produced by renderToString:
 *
 * - **Cache miss** markers (`data-cache="miss"`): extract inner HTML, store it
 *   in the segment cache, strip the wrapper tag.
 * - **Cache hit** markers (`data-cache="hit"`): strip the wrapper tag (the
 *   cached HTML is already the element content via dangerouslySetInnerHTML).
 *
 * Nested `CacheSegment` components are handled correctly because the
 * non-greedy regex naturally matches the innermost tag first, and we iterate
 * until the string stabilises.
 */
export function processSegmentCache(html: string): string {
    let prev: string;
    do {
        prev = html;
        html = html.replace(
            /<hadars-c([^>]*)>([\s\S]*?)<\/hadars-c>/g,
            (match, attrs: string, content: string) => {
                const cacheM = /data-cache="([^"]+)"/.exec(attrs);
                const keyM   = /data-key="([^"]+)"/.exec(attrs);
                const ttlM   = /data-ttl="(\d+)"/.exec(attrs);
                if (!cacheM || !keyM) return match;
                if (cacheM[1] === 'miss') {
                    setSegment(keyM[1]!, content, ttlM ? Number(ttlM[1]) : undefined);
                    return content;
                }
                if (cacheM[1] === 'hit') return content;
                return match;
            },
        );
    } while (html !== prev);
    return html;
}
