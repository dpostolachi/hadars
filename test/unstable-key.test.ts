/**
 * Unit tests for useServerData unstable-key detection.
 *
 * Two failure modes are exercised:
 *
 *  1. Server-side: a key first appears AFTER all existing cache entries are already
 *     fulfilled/rejected (i.e. the key must be changing between render passes).
 *     → useServerData throws an actionable Error immediately instead of looping
 *       25 times and then surfacing a generic "exceeded maximum retries" message.
 *
 *  2. Client-side (hydration time): SSR serialised data under key A, but the
 *     component asks for key B during hydration (e.g. the key was a module-level
 *     timestamp, stable across SSR passes but different on the client).
 *     → a console.warn is emitted after the hydration render settles, listing the
 *       orphaned SSR keys so the developer can fix them.
 */

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { useServerData, initServerDataCache } from '../src/utils/Head';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Install a minimal __hadarsUnsuspend context as the SSR render loop does. */
function startServerRender(
    preFilled?: Record<string, { status: 'fulfilled' | 'rejected'; value?: unknown; reason?: unknown }>,
) {
    const cache = new Map<string, any>(
        Object.entries(preFilled ?? {}).map(([k, v]) => [k, v]),
    );
    const unsuspend = { cache };
    (globalThis as any).__hadarsUnsuspend = unsuspend;
    return unsuspend;
}

function endServerRender() {
    (globalThis as any).__hadarsUnsuspend = null;
}

// ── server-side detection ─────────────────────────────────────────────────────

test('server-side: throws immediately when a new key appears after all existing keys are resolved', () => {
    startServerRender({
        // Simulate: a previous render pass already resolved 'stable_key'
        stable_key: { status: 'fulfilled', value: 42 },
    });

    try {
        // 'brand_new_key' has never been seen before, yet the cache has only
        // fulfilled entries → indicates an unstable key
        useServerData('brand_new_key', () => Promise.resolve('x'));
        throw new Error('expected useServerData to throw');
    } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const msg = (err as Error).message;
        expect(msg).toContain('[hadars] useServerData');
        expect(msg).toContain('brand_new_key');
        expect(msg).toContain('not stable across render passes');
        expect(msg).toContain('Date.now()');
    } finally {
        endServerRender();
    }
});

test('server-side: does NOT throw when the cache is empty (first render pass)', async () => {
    startServerRender(/* empty */);

    let caught: unknown = null;
    try {
        useServerData('first_key', async () => 'hello');
    } catch (e) {
        caught = e;
    } finally {
        endServerRender();
    }

    // Should throw a Promise (the pending async fn), not an Error
    expect(caught).not.toBeNull();
    expect(typeof (caught as any)?.then).toBe('function');
    expect(caught).not.toBeInstanceOf(Error);
});

test('server-side: does NOT throw when other pending entries exist alongside the new key', async () => {
    startServerRender({
        // At least one entry is still pending → we are mid-pass, not post-pass
        pending_key: { status: 'pending', promise: Promise.resolve() },
    });

    let caught: unknown = null;
    try {
        useServerData('another_new_key', async () => 'data');
    } catch (e) {
        caught = e;
    } finally {
        endServerRender();
    }

    // Should throw a Promise, not an Error — the detection guard must not fire here
    expect(caught).not.toBeNull();
    expect(typeof (caught as any)?.then).toBe('function');
    expect(caught).not.toBeInstanceOf(Error);
});

test('server-side: returns resolved value on subsequent pass once promise is fulfilled', async () => {
    startServerRender();

    const unsuspend = (globalThis as any).__hadarsUnsuspend;

    // First encounter — throws the pending promise
    let pendingPromise: unknown;
    try {
        useServerData('async_key', async () => 'resolved_value');
    } catch (e) {
        pendingPromise = e;
    }
    expect(pendingPromise).not.toBeNull();

    // Await the underlying async work so the cache transitions to fulfilled
    await pendingPromise;

    // Second pass — the value is now in the cache
    const value = useServerData('async_key', async () => 'should_not_be_called');
    expect(value).toBe('resolved_value');

    endServerRender();
});

// ── client-side detection ─────────────────────────────────────────────────────

// We need to simulate a browser environment for the client branch.
// Bun does not define `window`, so we temporarily attach it to globalThis.

let capturedWarnings: string[] = [];
let originalWarn: (...args: unknown[]) => void;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
    capturedWarnings = [];
    originalWarn  = console.warn;
    originalFetch = globalThis.fetch;

    console.warn = (...args: unknown[]) => {
        capturedWarnings.push(args.map(String).join(' '));
    };

    // Stub fetch so the client-side Suspense data-fetch doesn't make real requests.
    globalThis.fetch = async () =>
        new Response('{"serverData":{}}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
});

afterEach(() => {
    console.warn  = originalWarn;
    globalThis.fetch = originalFetch;
    delete (globalThis as any).window;
    // Reset the SSR-initial-key tracking state by clearing the cache.
    initServerDataCache({});
});

test('client-side: warns about unclaimed SSR keys after hydration (key mismatch)', async () => {
    // Simulate browser
    (globalThis as any).window = {
        location: { pathname: `/test-mismatch-${Date.now()}`, search: '' },
    };

    // SSR produced data under 'server_secret_key' (e.g. a module-level timestamp)
    initServerDataCache({ server_secret_key: { user: 'alice' } });

    // The component asks for 'client_secret_key' — different key (unstable)
    try {
        useServerData('client_secret_key', () => Promise.resolve(null));
    } catch (_e) {
        // Expected: throws a Suspense promise on cache miss
    }

    // Wait for: queueMicrotask (starts fetch stub) + fetch resolves + setTimeout(0) (warning)
    await new Promise(r => setTimeout(r, 20));

    expect(capturedWarnings.length).toBeGreaterThan(0);
    const warning = capturedWarnings.find(w => w.includes('[hadars] useServerData'));
    expect(warning).toBeDefined();
    expect(warning).toContain('server_secret_key');
    expect(warning).toContain('never claimed');
    expect(warning).toContain('Date.now()');
});

test('client-side: no warning when all SSR keys are claimed during hydration', async () => {
    (globalThis as any).window = {
        location: { pathname: `/test-clean-${Date.now()}`, search: '' },
    };

    // SSR produced data under 'my_data'
    initServerDataCache({ my_data: 42 });

    // The component asks for exactly 'my_data' — correct, stable key
    const result = useServerData('my_data', () => Promise.resolve(0));
    expect(result).toBe(42); // immediate cache hit

    await new Promise(r => setTimeout(r, 20));

    // No orphaned keys → no warning
    const hadarsWarning = capturedWarnings.find(w => w.includes('[hadars] useServerData'));
    expect(hadarsWarning).toBeUndefined();
});

test('client-side: warns only about the unclaimed subset when some keys match', async () => {
    (globalThis as any).window = {
        location: { pathname: `/test-partial-${Date.now()}`, search: '' },
    };

    initServerDataCache({ claimed_key: 'hello', orphan_key: 'world' });

    // 'claimed_key' is consumed correctly
    useServerData('claimed_key', () => Promise.resolve(''));

    // 'orphan_key' is never requested — simulates a second component whose key
    // was stable on the server but different on the client
    try {
        useServerData('wrong_key_on_client', () => Promise.resolve(null));
    } catch (_e) { /* Suspense promise */ }

    await new Promise(r => setTimeout(r, 20));

    const warning = capturedWarnings.find(w => w.includes('[hadars] useServerData'));
    expect(warning).toBeDefined();
    // orphan_key should be listed, claimed_key should NOT
    expect(warning).toContain('orphan_key');
    expect(warning).not.toContain('claimed_key');
});
