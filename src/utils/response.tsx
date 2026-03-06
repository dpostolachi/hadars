import type React from "react";
import { createRequire } from "node:module";
import pathMod from "node:path";
import { pathToFileURL } from "node:url";
import type { AppHead, AppUnsuspend, HadarsRequest, HadarsEntryBase, HadarsEntryModule, HadarsProps, AppContext } from "../types/hadars";

// Resolve react-dom/server from the *project's* node_modules (process.cwd()) so
// the same React instance is used here as in the SSR bundle. Without this,
// when hadars is installed as a file: symlink the renderer ends up on a
// different React than the component, breaking hook calls.
let _renderToStaticMarkup: ((element: any) => string) | null = null;
async function getStaticMarkupRenderer(): Promise<(element: any) => string> {
    if (!_renderToStaticMarkup) {
        const req = createRequire(pathMod.resolve(process.cwd(), '__hadars_fake__.js'));
        const resolved = req.resolve('react-dom/server');
        const mod = await import(pathToFileURL(resolved).href);
        _renderToStaticMarkup = mod.renderToStaticMarkup;
    }
    return _renderToStaticMarkup!;
}

interface ReactResponseOptions {
    document: {
        body: React.FC<HadarsProps<object>>;
        head?: () => Promise<React.ReactNode>;
        lang?: string;
        getInitProps: HadarsEntryModule<HadarsEntryBase>['getInitProps'];
        getAfterRenderProps: HadarsEntryModule<HadarsEntryBase>['getAfterRenderProps'];
        getFinalProps: HadarsEntryModule<HadarsEntryBase>['getFinalProps'];
    }
}

// ── Head HTML serialisation (no React render needed) ─────────────────────────

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escAttr = (s: string) => s.replace(/[&<>"]/g, c => ESC[c] ?? c);
const escText = (s: string) => s.replace(/[&<>]/g, c => ESC[c] ?? c);

// React prop → HTML attribute name for the subset used in head tags.
const ATTR: Record<string, string> = {
    className: 'class', htmlFor: 'for', httpEquiv: 'http-equiv',
    charSet: 'charset', crossOrigin: 'crossorigin', noModule: 'nomodule',
    referrerPolicy: 'referrerpolicy', fetchPriority: 'fetchpriority',
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

const getHeadHtml = (seoData: AppHead): string => {
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
    ReactPage: React.ReactElement,
    status: number,
    headHtml: string,
    renderPayload: {
        appProps: Record<string, unknown>;
        clientProps: Record<string, unknown>;
    };
}> => {
    const App = opts.document.body
    const { getInitProps, getAfterRenderProps, getFinalProps } = opts.document;

    const renderToStaticMarkup = await getStaticMarkupRenderer();

    // Per-request unsuspend context — populated by useServerData() hooks during render.
    // Lifecycle passes always run on the main thread so the cache is directly accessible.
    // Kept as a plain AppUnsuspend (no methods) so it is serializable via structuredClone
    // for postMessage to worker threads.
    const unsuspend: AppUnsuspend = {
        cache: new Map(),
        hasPending: false,
    };
    const processUnsuspend = async () => {
        const pending = [...unsuspend.cache.values()]
            .filter((e): e is { status: 'pending'; promise: Promise<unknown> } => e.status === 'pending')
            .map(e => e.promise);
        await Promise.all(pending);
    };

    const context: AppContext = {
        head: {
            title: "Hadars App",
            meta: {},
            link: {},
            style: {},
            script: {},
            status: 200,
        },
        _unsuspend: unsuspend,
    }

    let props: HadarsEntryBase = {
        ...(getInitProps ? await getInitProps(req) : {}),
        location: req.location,
        context,
    } as HadarsEntryBase

    // ── First lifecycle pass: useServerData render loop ───────────────────────
    // Render the component repeatedly until all useServerData() promises have
    // resolved. Each iteration discovers new pending promises; awaiting them
    // before the next pass ensures every hook returns its value by the final
    // iteration. Capped at 25 iterations as a safety guard against infinite loops.
    let html = '';
    let iters = 0;
    do {
        unsuspend.hasPending = false;
        try {
            (globalThis as any).__hadarsUnsuspend = unsuspend;
            html = renderToStaticMarkup(<App {...(props as any)} />);
        } finally {
            (globalThis as any).__hadarsUnsuspend = null;
        }
        if (unsuspend.hasPending) await processUnsuspend();
    } while (unsuspend.hasPending && ++iters < 25);
    if (unsuspend.hasPending) {
        console.warn('[hadars] SSR render loop hit the 25-iteration cap — some useServerData values may not be resolved. Check for data dependencies that are never fulfilled.');
    }

    if (getAfterRenderProps) {
        props = await getAfterRenderProps(props, html);
        // Re-render only when getAfterRenderProps is present — it may mutate
        // props that affect head tags, so we need another pass to capture them.
        try {
            (globalThis as any).__hadarsUnsuspend = unsuspend;
            renderToStaticMarkup(<App {...({ ...props, location: req.location, context })} />);
        } finally {
            (globalThis as any).__hadarsUnsuspend = null;
        }
    }

    // Serialize resolved useServerData() values for client hydration.
    // The client bootstrap reads __serverData and pre-populates the hook cache
    // before hydrateRoot so that useServerData() returns the same values CSR.
    const serverData: Record<string, unknown> = {};
    for (const [k, v] of unsuspend.cache) {
        if (v.status === 'fulfilled') serverData[k] = v.value;
    }

    const { context: _, ...restProps } = getFinalProps ? await getFinalProps(props) : props;
    const clientProps = {
        ...restProps,
        location: req.location,
        ...(Object.keys(serverData).length > 0 ? { __serverData: serverData } : {}),
    }

    const ReactPage = (
        <>
            <div id="app">
                <App {...({
                    ...props,
                    location: req.location,
                    context,
                })} />
            </div>
            <script id="hadars" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ hadars: { props: clientProps } }).replace(/</g, '\\u003c') }}></script>
        </>
    )

    return {
        ReactPage,
        status: context.head.status,
        headHtml: getHeadHtml(context.head),
        renderPayload: {
            appProps: { ...props, location: req.location, context } as Record<string, unknown>,
            clientProps: clientProps as Record<string, unknown>,
        },
    }

}
