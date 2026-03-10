import React from 'react';
import { getSegment, CACHE_TAG } from '../utils/segmentCache';

interface CacheSegmentProps {
    /**
     * Unique cache key for this segment. Use a key that encodes all values
     * the output depends on, e.g. `"product-" + product.id`.
     */
    cacheKey: string;
    /**
     * Time-to-live in milliseconds. Omit for entries that never expire.
     */
    ttl?: number;
    children: React.ReactNode;
}

/**
 * Caches the server-rendered HTML of its children across requests.
 *
 * **Server (SSR):**
 * - Cache miss — children are rendered normally as part of the main
 *   `renderToString` call, so React context propagates correctly. The output
 *   is wrapped in a `<hadars-c>` marker that `processSegmentCache` uses to
 *   extract and store the HTML. The marker is stripped before the response
 *   is sent; the browser never sees it.
 * - Cache hit — children are **not** rendered at all. The cached HTML is
 *   injected directly, saving the entire subtree render cost.
 *
 * **Client:** renders children normally (no caching). Because the server
 * strips the marker wrapper, the client output matches the server HTML and
 * React hydration succeeds without warnings for deterministic components.
 *
 * **Note:** components that rely on request-specific data (cookies, auth,
 * personalisation) must not be wrapped in `CacheSegment` unless the cache
 * key encodes that data — otherwise a cached response for one user could be
 * served to another.
 */
export function CacheSegment({ cacheKey, ttl, children }: CacheSegmentProps) {
    // Client: render children normally — no server cache on the client.
    if (typeof window !== 'undefined') {
        return <>{children}</>;
    }

    const cached = getSegment(cacheKey);

    if (cached !== null) {
        // Cache hit: skip rendering children entirely.
        // The <hadars-c> wrapper is stripped by processSegmentCache before
        // the response is sent to the browser.
        return React.createElement(CACHE_TAG as any, {
            'data-key': cacheKey,
            'data-cache': 'hit',
            dangerouslySetInnerHTML: { __html: cached },
        });
    }

    // Cache miss: render children as normal React elements so that React
    // context (providers, etc.) propagates correctly into the subtree.
    // processSegmentCache will extract the rendered HTML and store it.
    const props: Record<string, unknown> = {
        'data-key': cacheKey,
        'data-cache': 'miss',
    };
    if (ttl != null) props['data-ttl'] = ttl;

    return React.createElement(CACHE_TAG as any, props, children);
}
