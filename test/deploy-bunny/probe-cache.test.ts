import { expect, test } from 'bun:test';
import { forbidsReuse } from '../../src/deploy/bunny/probe';

// An edge CDN layer rewrites `no-store` to `no-cache` on script responses (measured on a real CDN): both forbid reuse without revalidation.
test('reuse-forbidding cache-control values are accepted, cacheable ones are not', () => {
    for (const value of ['no-store', 'no-cache', 'No-Store', 'private, no-cache', 'no-cache, no-store, must-revalidate']) expect(forbidsReuse(value)).toBe(true);
    for (const value of [null, '', 'public, max-age=2592000', 'max-age=60', 'public', 'no-store-ish']) expect(forbidsReuse(value)).toBe(false);
});
