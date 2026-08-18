import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import type { HadarsEntryModule } from '../types/hadars';
import { initServerDataCache } from 'hadars';
import * as _appMod from '$_MOD_PATH$';

const appMod = _appMod as HadarsEntryModule<{}>;

const getProps = () => {
    const script = document.getElementById('hadars');
    if (script) {
        try {
            const data = JSON.parse(script.textContent || '{}');
            return data.hadars?.props || {};
        } catch (e) {
            return {};
        }
    }
    return {};
}

const main = async () => {
    let props = getProps();

    // Extract the static-export flag before it reaches user code. When set,
    // useServerData fetches index.json sidecars directly on client navigation
    // instead of requesting the live SSR server with Accept: application/json.
    if ((props as any).__hadarsStatic) {
        (globalThis as any).__hadarsStatic = true;
        const { __hadarsStatic: _, ...rest } = props as any;
        props = rest;
    }

    // Seed the useServerData client cache from server-resolved values before
    // hydration so that hooks return the same data on the first render.
    if (props.__serverData && typeof props.__serverData === 'object') {
        initServerDataCache(props.__serverData as Record<string, unknown>);
        const { __serverData: _, ...rest } = props;
        props = rest;
    }

    const { location } = props;

    if (appMod.getClientProps) {
        try {
            props = await appMod.getClientProps(props);
        } catch (err) {
            console.error('[hadars] getClientProps threw an error:', err);
        }
    }

    props = {
        ...props,
        location,
    }

    const Component = appMod.default;

    const appEl = document.getElementById("app");
    if (!appEl) return;

    const hot = (import.meta as any).webpackHot ?? (typeof module !== 'undefined' ? (module as any).hot : undefined);

    if (!hot) {
        hydrateRoot(appEl, <Component {...props} />);
        return;
    }

    // --- Dev (HMR) path ---------------------------------------------------
    // React Fast Refresh patches component implementations in place and then
    // re-renders through the EXISTING root. That only works if the root
    // survives across hot updates, so it is cached on globalThis rather than
    // recreated here — this module itself is re-evaluated on a hot update, and
    // calling createRoot() again would tear down the tree and reset all state,
    // which is precisely the "HMR doesn't work" symptom (updates only appearing
    // after a manual refresh, component state lost).
    const store = globalThis as any;

    if (!store.__hadarsRoot) {
        // First evaluation: adopt the server-rendered markup.
        store.__hadarsRoot = hydrateRoot(appEl, <Component {...props} />);
    } else {
        // Hot update: reuse the existing root so state is preserved.
        store.__hadarsRoot.render(<Component {...props} />);
    }

    // Accept updates to this entry and to the user's app module. Without an
    // accept handler the update propagates past the entry with nowhere to stop,
    // and the HMR runtime falls back to a full page reload
    // ("Aborted because ./src/App.tsx is not accepted").
    hot.accept('$_MOD_PATH$', () => {
        // The updated module is re-imported by the runtime; re-render through
        // the cached root with the fresh component.
        const Next = (_appMod as HadarsEntryModule<{}>).default;
        store.__hadarsRoot.render(<Next {...props} />);
    });
}

main();