import { test, expect, describe } from 'bun:test';
import React from 'react';
import { getReactResponse, buildHeadHtml } from '../src/utils/response';
import {
    buildSsrResponse,
    buildSsrHtml,
    makePrecontentHtmlGetter,
    LANG_MARKER,
} from '../src/utils/ssrHandler';
import { parseRequest } from '../src/utils/request';
import { LocaleProvider, parseLocaleFromPath, type HadarsI18nConfig } from '../src/i18n';
import type { HadarsProps } from '../src/types/hadars';

const I18N_CONFIG: HadarsI18nConfig = { locales: ['en', 'ro', 'ru'], defaultLocale: 'en' };

const TEMPLATE = `<!DOCTYPE html>
<html lang="${LANG_MARKER}">
<head>
<meta name="HADARS_HEAD">
</head>
<body>
<meta name="HADARS_BODY">
</body>
</html>`;

function LocalizedApp(props: HadarsProps<{}>) {
    const { locale } = parseLocaleFromPath(props.location, I18N_CONFIG);
    return (
        <LocaleProvider initialLocale={locale} locales={I18N_CONFIG.locales} defaultLocale={I18N_CONFIG.defaultLocale}>
            <p>hello</p>
        </LocaleProvider>
    );
}

async function renderToHtml(body: React.FC<HadarsProps<object>>, urlPath: string): Promise<string> {
    const req = parseRequest(new Request('http://localhost' + urlPath));
    const { head, getAppBody, finalize } = await getReactResponse(req, {
        document: { body: body as any, getInitProps: undefined, getFinalProps: undefined },
        singlePass: true,
    });
    const bodyHtml = await getAppBody();
    const { clientProps } = await finalize();
    const headHtml = buildHeadHtml(head);
    const getPrecontentHtml = makePrecontentHtmlGetter(Promise.resolve(TEMPLATE));
    return buildSsrHtml(bodyHtml, clientProps, headHtml, getPrecontentHtml, head.lang);
}

describe('html lang - non-streaming SSR / static export path (buildSsrHtml)', () => {
    test('default-locale path (unprefixed) renders lang="en"', async () => {
        const html = await renderToHtml(LocalizedApp, '/about');
        expect(html).toContain('<html lang="en">');
    });

    test('a locale-prefixed path renders the matching lang, e.g. /ro/about', async () => {
        const html = await renderToHtml(LocalizedApp, '/ro/about');
        expect(html).toContain('<html lang="ro">');
    });

    test('a different locale prefix renders its own lang, e.g. /ru/about', async () => {
        const html = await renderToHtml(LocalizedApp, '/ru/about');
        expect(html).toContain('<html lang="ru">');
    });

    test('the raw HADARS_LANG marker never leaks into the output', async () => {
        const html = await renderToHtml(LocalizedApp, '/ro/about');
        expect(html).not.toContain('HADARS_LANG');
    });

    test('apps that do not use LocaleProvider fall back to lang="en"', async () => {
        function PlainApp() { return <p>hi</p>; }
        const html = await renderToHtml(PlainApp, '/');
        expect(html).toContain('<html lang="en">');
    });
});

describe('html lang - streaming SSR path (buildSsrResponse)', () => {
    test('the streamed response contains the resolved lang attribute', async () => {
        const req = parseRequest(new Request('http://localhost/ru/about'));
        const { head, status, getAppBody, finalize } = await getReactResponse(req, {
            document: { body: LocalizedApp as any, getInitProps: undefined, getFinalProps: undefined },
            singlePass: true,
        });
        const getPrecontentHtml = makePrecontentHtmlGetter(Promise.resolve(TEMPLATE));
        const res = buildSsrResponse(head, status, getAppBody, finalize, getPrecontentHtml);
        const html = await res.text();
        expect(html).toContain('<html lang="ru">');
        expect(html).not.toContain('HADARS_LANG');
    });

    test('two requests for different locales never bleed into each other', async () => {
        const getPrecontentHtml = makePrecontentHtmlGetter(Promise.resolve(TEMPLATE));

        const roReq = parseRequest(new Request('http://localhost/ro/about'));
        const ro = await getReactResponse(roReq, {
            document: { body: LocalizedApp as any, getInitProps: undefined, getFinalProps: undefined },
            singlePass: true,
        });
        const roHtml = await buildSsrResponse(ro.head, ro.status, ro.getAppBody, ro.finalize, getPrecontentHtml).then(r => r.text());

        const enReq = parseRequest(new Request('http://localhost/about'));
        const en = await getReactResponse(enReq, {
            document: { body: LocalizedApp as any, getInitProps: undefined, getFinalProps: undefined },
            singlePass: true,
        });
        const enHtml = await buildSsrResponse(en.head, en.status, en.getAppBody, en.finalize, getPrecontentHtml).then(r => r.text());

        expect(roHtml).toContain('<html lang="ro">');
        expect(enHtml).toContain('<html lang="en">');
    });
});

describe('html lang - injection safety', () => {
    test('an untrusted lang value is HTML-escaped, never raw-injected', async () => {
        function InjectingApp() {
            return (
                <LocaleProvider initialLocale={'"><script>alert(1)</script>'} locales={['en']} defaultLocale="en">
                    <p>hi</p>
                </LocaleProvider>
            );
        }
        const html = await renderToHtml(InjectingApp, '/');
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });
});
