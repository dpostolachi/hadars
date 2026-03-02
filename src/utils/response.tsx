import type React from "react";
import { createRequire } from "node:module";
import pathMod from "node:path";
import { pathToFileURL } from "node:url";
import type { AppHead, AppUnsuspend, HadarsRequest, HadarsEntryBase, HadarsEntryModule, HadarsProps, AppContext } from "../types/ninety";

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

const getHeadHtml = (seoData: AppHead, renderToStaticMarkup: (el: any) => string): string => {
    const metaEntries = Object.entries(seoData.meta)
    const linkEntries = Object.entries(seoData.link)
    const styleEntries = Object.entries(seoData.style)
    const scriptEntries = Object.entries(seoData.script)

    return renderToStaticMarkup(
        <>
            <title>{seoData.title}</title>
            {
            metaEntries.map( ([id, options]) => (
                <meta
                    key={id}
                    id={ id }
                    { ...options }
                />
            ) )
            }
            {linkEntries.map( ([id, options]) => (
                <link
                    key={id}
                    id={ id }
                    { ...options }
                />
            ))}
            {styleEntries.map( ([id, options]) => (
                <style
                    key={id}
                    id={id}
                    { ...options }
                />
            ))}
            {scriptEntries.map( ([id, options]) => (
                <script
                    key={id}
                    id={id}
                    { ...options }
                />
            ))}
        </>
    )
}


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

    props = getAfterRenderProps ? await getAfterRenderProps(props, html) : props;
    // Re-render to capture any head changes introduced by getAfterRenderProps.
    try {
        (globalThis as any).__hadarsUnsuspend = unsuspend;
        renderToStaticMarkup(
            <App {...({
                ...props,
                location: req.location,
                context,
            })} />
        );
    } finally {
        (globalThis as any).__hadarsUnsuspend = null;
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
            <script id="hadars" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ hadars: { props: clientProps } }) }}></script>
        </>
    )

    return {
        ReactPage,
        status: context.head.status,
        headHtml: getHeadHtml(context.head, renderToStaticMarkup),
        renderPayload: {
            appProps: { ...props, location: req.location, context } as Record<string, unknown>,
            clientProps: clientProps as Record<string, unknown>,
        },
    }

}
