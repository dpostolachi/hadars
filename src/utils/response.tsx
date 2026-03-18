import type React from "react";
import type { AppHead, HadarsRequest, HadarsEntryBase, HadarsEntryModule, HadarsProps, AppContext } from "../types/hadars";
import { renderToString, createElement } from '../slim-react/index';
import { processSegmentCache } from './segmentCache';

interface ReactResponseOptions {
    document: {
        body: React.FC<HadarsProps<object>>;
        head?: () => Promise<React.ReactNode>;
        lang?: string;
        getInitProps: HadarsEntryModule<HadarsEntryBase>['getInitProps'];
        getFinalProps: HadarsEntryModule<HadarsEntryBase>['getFinalProps'];
    }
}

// ── Head HTML serialisation ────────────────────────────────────────────────

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escAttr = (s: string) => s.replace(/[&<>"]/g, c => ESC[c] ?? c);
const escText = (s: string) => s.replace(/[&<>]/g, c => ESC[c] ?? c);

const ATTR: Record<string, string> = {
    className: 'class', htmlFor: 'for', httpEquiv: 'http-equiv',
    charSet: 'charset', crossOrigin: 'crossorigin', noModule: 'nomodule',
    referrerPolicy: 'referrerpolicy', fetchPriority: 'fetchpriority',
    hrefLang: 'hreflang',
};

function renderHeadTag(tag: string, opts: Record<string, unknown>, selfClose = false): string {
    let attrs = '';
    let inner = '';
    for (const [k, v] of Object.entries(opts)) {
        if (k === 'key' || k === 'children') continue;
        if (k === 'dangerouslySetInnerHTML') { inner = (v as any).__html ?? ''; continue; }
        const attr = ATTR[k] ?? k;
        if (v === true) attrs += ` ${attr}`;
        else if (v !== false && v != null) attrs += ` ${attr}="${escAttr(String(v))}"`;
    }
    return selfClose ? `<${tag}${attrs}>` : `<${tag}${attrs}>${inner}</${tag}>`;
}

const getHeadHtml = (seoData: AppHead): string => {
    let html = `<title>${escText(seoData.title ?? '')}</title>`;
    for (const opts of Object.values(seoData.meta))
        html += renderHeadTag('meta', opts as Record<string, unknown>, true);
    for (const opts of Object.values(seoData.link))
        html += renderHeadTag('link', opts as Record<string, unknown>, true);
    for (const opts of Object.values(seoData.style))
        html += renderHeadTag('style', opts as Record<string, unknown>);
    for (const opts of Object.values(seoData.script))
        html += renderHeadTag('script', opts as Record<string, unknown>);
    return html;
};

export const getReactResponse = async (
    req: HadarsRequest,
    opts: ReactResponseOptions,
): Promise<{
    bodyHtml: string,
    clientProps: Record<string, unknown>,
    status: number,
    headHtml: string,
}> => {
    const App = opts.document.body;
    const { getInitProps, getFinalProps } = opts.document;

    const context: AppContext = {
        head: { title: 'Hadars App', meta: {}, link: {}, style: {}, script: {}, status: 200 },
    };

    let props: HadarsEntryBase = {
        ...(getInitProps ? await getInitProps(req) : {}),
        location: req.location,
        context,
    } as HadarsEntryBase;

    // Create per-request cache for useServerData, active for all renders.
    const unsuspend = { cache: new Map<string, any>() };
    (globalThis as any).__hadarsUnsuspend = unsuspend;
    let bodyHtml: string;
    try {
        bodyHtml = await renderToString(createElement(App as any, props as any));
    } finally {
        (globalThis as any).__hadarsUnsuspend = null;
    }

    const { context: _, ...restProps } = getFinalProps ? await getFinalProps(props) : props;

    // Collect fulfilled useServerData values for client-side hydration.
    const serverData: Record<string, unknown> = {};
    for (const [key, entry] of unsuspend.cache) {
        if (entry.status === 'fulfilled') serverData[key] = entry.value;
    }
    const clientProps = {
        ...restProps,
        location: req.location,
        ...(Object.keys(serverData).length > 0 ? { __serverData: serverData } : {}),
    };

    return {
        bodyHtml: processSegmentCache(bodyHtml),
        clientProps: clientProps as Record<string, unknown>,
        status: context.head.status,
        headHtml: getHeadHtml(context.head),
    };
};
