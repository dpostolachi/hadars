import { test, expect } from 'bun:test';
import { splitFetchResult, withSsrHeaders } from '../src/utils/fetchResult';
import { createBunnyHandler } from '../src/bunny';
import type { HadarsOptions } from '../src/types/hadars';

const bundled = { ssrModule: { default: () => null }, outHtml: '<head><meta name="HADARS_HEAD"></head><meta name="HADARS_BODY">' };

test('splitFetchResult tells a response from headers and from nothing', () => {
    const response = new Response('x');
    expect(splitFetchResult(response)).toEqual({ response });
    const split = splitFetchResult({ headers: { 'cache-control': 'private, no-store' } });
    expect(split.response).toBeUndefined();
    expect(split.ssrHeaders?.get('cache-control')).toBe('private, no-store');
    expect(splitFetchResult(undefined)).toEqual({});
});

test('withSsrHeaders adds and overrides headers and keeps the status', async () => {
    const response = new Response('body', { status: 201, headers: { 'x-a': '1' } });
    expect(withSsrHeaders(response, undefined)).toBe(response);
    const merged = withSsrHeaders(response, new Headers({ 'x-a': '2', 'x-b': '3' }));
    expect(merged.status).toBe(201);
    expect(merged.headers.get('x-a')).toBe('2');
    expect(merged.headers.get('x-b')).toBe('3');
    expect(await merged.text()).toBe('body');
});

test('fetch headers apply to SSR responses only, not to proxied or fetch-returned responses', async () => {
    const handler = createBunnyHandler({
        entry: '',
        fetch: (req) => new URL(req.url).pathname === '/gateway' ? new Response('gateway') : { headers: { 'cache-control': 'private, no-store', 'x-test': 'ssr' } },
        proxy: (req) => new URL(req.url).pathname === '/proxied' ? new Response('proxied') : null,
    } as HadarsOptions, bundled);

    const page = await handler(new Request('https://example.test/'));
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('private, no-store');
    expect(page.headers.get('x-test')).toBe('ssr');
    await page.text();

    const data = await handler(new Request('https://example.test/', { headers: { accept: 'application/json' } }));
    expect(data.headers.get('x-test')).toBe('ssr');
    await data.text();

    const proxied = await handler(new Request('https://example.test/proxied'));
    expect(await proxied.text()).toBe('proxied');
    expect(proxied.headers.get('x-test')).toBeNull();
    expect(proxied.headers.get('cache-control')).toBeNull();

    const gateway = await handler(new Request('https://example.test/gateway'));
    expect(await gateway.text()).toBe('gateway');
    expect(gateway.headers.get('x-test')).toBeNull();
});

test('fetch headers also apply to SSR render errors', async () => {
    const handler = createBunnyHandler({
        entry: '',
        fetch: () => ({ headers: { 'x-test': 'ssr' } }),
    } as HadarsOptions, { ...bundled, ssrModule: { default: () => null, getInitProps: () => { throw new Error('expected'); } } });
    const res = await handler(new Request('https://example.test/'));
    expect(res.status).toBe(500);
    expect(res.headers.get('x-test')).toBe('ssr');
    await res.text();
});
