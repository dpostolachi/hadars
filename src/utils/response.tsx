import type React from "react";
import type { AppHead, HadarsRequest, HadarsEntryBase, HadarsEntryModule, HadarsProps, AppContext, HadarsStaticContext } from "../types/hadars";
import { renderToString, renderPreflight, createElement } from '../slim-react/index';

interface ReactResponseOptions {
    document: {
        body: React.FC<HadarsProps<object>>;
        head?: () => Promise<React.ReactNode>;
        lang?: string;
        getInitProps: HadarsEntryModule<HadarsEntryBase>['getInitProps'];
        getFinalProps: HadarsEntryModule<HadarsEntryBase>['getFinalProps'];
    }
    staticCtx?: HadarsStaticContext;
    /**
     * Skip the preflight pass and render in a single tree walk.
     *
     * `renderToString` already self-retries on suspension (it handles
     * `useServerData` inline), so the only purpose of the preflight is to
     * populate `context.head` before the body is streamed. When the head is
     * small (title + a few metas) and early-flush is not critical — e.g. in
     * dev mode — a single pass halves the render work.
     */
    singlePass?: boolean;
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

function renderHeadTag(tag: string, id: string, opts: Record<string, unknown>, selfClose = false): string {
    let attrs = ` id="${escAttr(id)}"`;
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

export function buildHeadHtml(seoData: AppHead): string {
    let html = `<title>${escText(seoData.title ?? '')}</title>`;
    for (const [id, opts] of Object.entries(seoData.meta))
        html += renderHeadTag('meta', id, opts as Record<string, unknown>, true);
    for (const [id, opts] of Object.entries(seoData.link))
        html += renderHeadTag('link', id, opts as Record<string, unknown>, true);
    for (const [id, opts] of Object.entries(seoData.style))
        html += renderHeadTag('style', id, opts as Record<string, unknown>);
    for (const [id, opts] of Object.entries(seoData.script))
        html += renderHeadTag('script', id, opts as Record<string, unknown>);
    return html;
};

export const getReactResponse = async (
    req: HadarsRequest,
    opts: ReactResponseOptions,
): Promise<{
    /** Head object — populated by the preflight walk, ready for buildHeadHtml(). */
    head: AppHead,
    status: number,
    /** Renders the App to an HTML string. Call AFTER flushing head. */
    getAppBody: () => Promise<string>,
    /** Call after streaming the body to assemble the final client props. */
    finalize: () => Promise<{ clientProps: Record<string, unknown> }>,
}> => {
    const App = opts.document.body;
    const { getInitProps, getFinalProps } = opts.document;

    const context: AppContext = {
        head: { title: 'Hadars App', meta: {}, link: {}, style: {}, script: {}, status: 200 },
    };

    let props: HadarsEntryBase = {
        ...(getInitProps ? await getInitProps(req, opts.staticCtx) : {}),
        location: req.location,
        context,
    } as HadarsEntryBase;

    // Per-request cache for useServerData — set before rendering so every
    // component in the tree that calls useServerData finds the same cache.
    // captureUnsuspend / restoreUnsuspend in the renderer ensure it survives
    // await continuations even when concurrent requests are in flight.
    const unsuspend = { cache: new Map<string, any>() };
    (globalThis as any).__hadarsUnsuspend = unsuspend;
    // Expose the head context so HadarsHead can write into it without needing
    // the user to manually wrap their App with HadarsContext.
    (globalThis as any).__hadarsContext = context;

    const element = createElement(App as any, props as any);

    let bodyHtml: string | null = null;

    if (opts.singlePass) {
        // Single-pass: renderToString already self-retries on suspension so it
        // resolves useServerData inline and populates context.head in one walk.
        // getAppBody() returns the pre-rendered string immediately.
        (globalThis as any).__hadarsUnsuspend = unsuspend;
        (globalThis as any).__hadarsContext = context;
        try {
            bodyHtml = await renderToString(element);
        } finally {
            (globalThis as any).__hadarsUnsuspend = null;
            (globalThis as any).__hadarsContext = null;
        }
    } else {
        // Two-pass: preflight walk populates context.head before the body is
        // rendered so the head can be streamed to the client first (early CSS/font
        // hints). Useful in production where LCP matters.
        try {
            await renderPreflight(element);
        } finally {
            (globalThis as any).__hadarsUnsuspend = null;
            (globalThis as any).__hadarsContext = null;
        }
    }

    // Head is fully populated — status is known.
    const status = context.head.status;

    const getAppBody = async (): Promise<string> => {
        if (bodyHtml !== null) return bodyHtml;
        // Two-pass: all data cached from preflight, second pass is fast.
        (globalThis as any).__hadarsUnsuspend = unsuspend;
        (globalThis as any).__hadarsContext = context;
        try {
            return await renderToString(element);
        } finally {
            (globalThis as any).__hadarsUnsuspend = null;
            (globalThis as any).__hadarsContext = null;
        }
    };

    const finalize = async (): Promise<{ clientProps: Record<string, unknown> }> => {
        const restProps = getFinalProps ? await getFinalProps(props) : props;
        const serverData: Record<string, unknown> = {};
        let hasServerData = false;
        for (const [key, entry] of unsuspend.cache) {
            if ((entry as any).status === 'fulfilled') {
                serverData[key] = (entry as any).value;
                hasServerData = true;
            }
        }
        return {
            clientProps: {
                ...restProps,
                location: req.location,
                ...(hasServerData ? { __serverData: serverData } : {}),
            } as Record<string, unknown>,
        };
    };

    return { head: context.head, status, getAppBody, finalize };
};
