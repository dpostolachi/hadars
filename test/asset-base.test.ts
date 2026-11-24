import { afterEach, expect, test, spyOn } from 'bun:test';
import React from 'react';
import { createLambdaHandler } from '../src/lambda';
import { createBunnyHandler } from '../src/bunny';
import { createCloudflareHandler } from '../src/cloudflare';
import { buildSsrHtml, makePrecontentHtmlGetter } from '../src/utils/ssrHandler';
import { deploymentPinnedClients, validateAssetBase } from '../src/utils/assetBase';

const original = process.env.HADARS_ASSET_BASE_URL;
afterEach(() => {
    if (original === undefined) delete process.env.HADARS_ASSET_BASE_URL;
    else process.env.HADARS_ASSET_BASE_URL = original;
});
const built = 'https://built.example/assets';
const metadata = encodeURIComponent(JSON.stringify({ base: built, files: ['entry.123.js', 'style.123.css'] }));
const template = `<html><head><meta name="HADARS_ASSET_BASE" content="${metadata}"><script src="${built}/entry.123.js" integrity="sha256-test"></script><link rel="stylesheet" href="${built}/style.123.css"><link rel="preload" href="${built}/entry.123.js"><a href="/account">account</a><meta name="HADARS_HEAD"></head><body><meta name="HADARS_BODY"></body></html>`;
const render = () => buildSsrHtml('body', {}, '', makePrecontentHtmlGetter(Promise.resolve(template)));

test('unset keeps built URLs without an executable override', async () => {
    delete process.env.HADARS_ASSET_BASE_URL;
    const html = await render();
    expect(html).toContain(`${built}/entry.123.js`);
    expect(html).not.toContain('__HADARS_ASSET_BASE_URL__');
    expect(html).not.toContain('HADARS_ASSET_BASE"');
});

test('runtime base relocates entry, styles and preloads before scripts, retaining integrity', async () => {
    process.env.HADARS_ASSET_BASE_URL = 'https://runtime.example/preview///';
    const html = await render();
    expect(html).toContain('src="https://runtime.example/preview/entry.123.js" integrity="sha256-test"');
    expect(html).toContain('href="https://runtime.example/preview/style.123.css"');
    expect(html).toContain('rel="preload" href="https://runtime.example/preview/entry.123.js"');
    expect(html.indexOf('__HADARS_ASSET_BASE_URL__')).toBeLessThan(html.indexOf('src='));
    expect(html).toContain('href="/account"');
    expect(html).not.toContain(built);
});

test('invalid bases warn and fall back', async () => {
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    try {
        for (const value of ['', '//other.example', 'javascript:alert(1)', 'https://', '/x?query', '/x#fragment', '/\\host', 'https://user:pass@example.test', '/x\n', '/x"', 'relative']) {
            process.env.HADARS_ASSET_BASE_URL = value;
            expect(await render()).toContain(`${built}/entry.123.js`);
        }
        expect(warning).toHaveBeenCalledTimes(11);
        expect(validateAssetBase('/')).toBe('');
        expect(validateAssetBase('/preview///')).toBe('/preview');
    } finally { warning.mockRestore(); }
});

test('pinned assets follow the base while separate origins and SRI remain intact', () => {
    const clients = { local: { baseUrl: '/_builds/id/', integrity: { 'entry.js': 'sha256-test' } },
        same: { baseUrl: `${built}/_builds/id/` }, separate: { baseUrl: 'https://modules.example/id/' } };
    const result = deploymentPinnedClients(clients, template, '/preview');
    expect(result?.local.baseUrl).toBe('/preview/_builds/id/');
    expect(result?.same.baseUrl).toBe('/preview/_builds/id/');
    expect(result?.separate.baseUrl).toBe(clients.separate.baseUrl);
    expect(result?.local.integrity).toEqual(clients.local.integrity);
    expect(clients.local.baseUrl).toBe('/_builds/id/');
});

const options = { entry: 'unused.tsx' };
const bundled = { ssrModule: { default: () => React.createElement('p', null, 'rendered') }, outHtml: template };

test('function handler reads process environment at runtime', async () => {
    process.env.HADARS_ASSET_BASE_URL = '/deployed';
    const handler = createLambdaHandler(options, bundled);
    const response = await handler({ version: '2.0', routeKey: '$default', rawPath: '/', rawQueryString: '', headers: {},
        requestContext: { http: { method: 'GET' }, domainName: 'shell.example' }, isBase64Encoded: false });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('/deployed/entry.123.js');
});

test('edge handler reads runtime environment API', async () => {
    const runtime = globalThis as any;
    const previous = runtime.Deno;
    runtime.Deno = { env: { get: (key: string) => key === 'HADARS_ASSET_BASE_URL' ? '/edge' : undefined } };
    try {
        const response = await createBunnyHandler(options, bundled)(new Request('https://shell.example/'));
        expect(await response.text()).toContain('/edge/entry.123.js');
    } finally { runtime.Deno = previous; }
});

test('binding environments and response caches stay isolated across concurrent requests', async () => {
    process.env.HADARS_ASSET_BASE_URL = '/wrong-process-base';
    const handler = createCloudflareHandler({ ...options, cache: () => ({ key: 'page' }) }, bundled);
    const html = await Promise.all(['/first', '/second', undefined].map(async value => {
        const response = await handler.fetch(new Request('https://shell.example/'), { HADARS_ASSET_BASE_URL: value }, {});
        return response.text();
    }));
    expect(html[0]).toContain('/first/entry.123.js');
    expect(html[1]).toContain('/second/entry.123.js');
    expect(html[2]).toContain(`${built}/entry.123.js`);
});
