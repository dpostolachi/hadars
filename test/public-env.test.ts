import { afterEach, expect, test } from 'bun:test';
import React from 'react';
import { getPublicEnv } from '../src/index';
import { readPublicEnv, publicEnvJson } from '../src/utils/publicEnv';
import { buildSsrHtml, makePrecontentHtmlGetter } from '../src/utils/ssrHandler';
import { getReactResponse } from '../src/utils/response';
import { parseRequest } from '../src/utils/request';

const name = 'HADARS_PUBLIC_CLIENT_ID';
const original = process.env[name];
const runtime = globalThis as any;
afterEach(() => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
    delete runtime.__HADARS_PUBLIC_ENV__;
});
const template = '<html><head><script src="/entry.js"></script><meta name="HADARS_HEAD"></head><body><meta name="HADARS_BODY"></body></html>';

async function render() {
    const result = await getReactResponse(parseRequest(new Request('https://example.test/')), {
        document: { body: () => React.createElement('p', null, getPublicEnv(name, 'built')), getInitProps: undefined, getFinalProps: undefined },
        singlePass: true,
    });
    return buildSsrHtml(await result.getAppBody(), {}, '', makePrecontentHtmlGetter(Promise.resolve(template)));
}

test('SSR reads runtime values, including empty strings, and falls back when unset', async () => {
    delete process.env[name];
    expect(await render()).toContain('<p>built</p>');
    process.env[name] = 'deployment';
    const html = await render();
    expect(html).toContain('<p>deployment</p>');
    expect(html).toContain('"HADARS_PUBLIC_CLIENT_ID":"deployment"');
    expect(html.indexOf('__HADARS_PUBLIC_ENV__')).toBeLessThan(html.indexOf('src='));
    process.env[name] = '';
    expect(await render()).toContain('<p></p>');
});

test('publication is prefix restricted, string only, and bounded after escaping', () => {
    const values = readPublicEnv({ [name]: 'public', SECRET_TOKEN: 'private', HADARS_APP_ID: 'built',
        HADARS_PUBLIC_OBJECT: { secret: true }, HADARS_PUBLIC_TOO_BIG: '<'.repeat(40000),
        'HADARS_PUBLIC_bad': 'invalid', HADARS_PUBLIC_: 'invalid' });
    expect(values).toEqual({ [name]: 'public' });
    const many = readPublicEnv(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`HADARS_PUBLIC_ITEM_${i}`, 'x'.repeat(500)])));
    expect(new TextEncoder().encode(publicEnvJson(many)).length).toBeLessThanOrEqual(32768);
    expect(getPublicEnv('SECRET_TOKEN', 'fallback')).toBe('fallback');
});

test('HTML escapes script terminators and unicode line separators without changing values', async () => {
    const value = '</script><script>bad()</script>\u2028\u2029';
    process.env[name] = value;
    const html = await buildSsrHtml('', {}, '', makePrecontentHtmlGetter(Promise.resolve(template)));
    const payload = html.match(/globalThis\.__HADARS_PUBLIC_ENV__=(.*?)<\/script>/)![1]!;
    expect(payload).not.toContain('<');
    expect(payload).not.toContain('\u2028');
    expect(payload).not.toContain('\u2029');
    expect(payload).toContain('\\u2028\\u2029');
    expect(JSON.parse(payload)[name]).toBe(value);
});

test('client helper reads the injected global, own strings only, with fallback', () => {
    runtime.__HADARS_PUBLIC_ENV__ = Object.assign(Object.create({ HADARS_PUBLIC_INHERITED: 'bad' }), { [name]: 'injected', HADARS_PUBLIC_NUMBER: 42 });
    expect(getPublicEnv(name, 'built')).toBe('injected');
    expect(getPublicEnv('HADARS_PUBLIC_MISSING', 'built')).toBe('built');
    expect(getPublicEnv('HADARS_PUBLIC_INHERITED')).toBeUndefined();
    expect(getPublicEnv('HADARS_PUBLIC_NUMBER', 'built')).toBe('built');
});

test('template getter reads each request instead of retaining the first environment', async () => {
    const getter = makePrecontentHtmlGetter(Promise.resolve(template));
    process.env[name] = 'first';
    expect(await buildSsrHtml('', {}, '', getter)).toContain('"HADARS_PUBLIC_CLIENT_ID":"first"');
    delete process.env[name];
    expect(await buildSsrHtml('', {}, '', getter)).not.toContain('"HADARS_PUBLIC_CLIENT_ID"');
});

test('runtime environment API provides public values', () => {
    const previous = runtime.Deno;
    runtime.Deno = { env: { toObject: () => ({ [name]: 'edge', SECRET_TOKEN: 'private' }) } };
    try {
        expect(readPublicEnv()).toEqual({ [name]: 'edge' });
        expect(getPublicEnv(name, 'built')).toBe('edge');
    } finally { runtime.Deno = previous; }
});
