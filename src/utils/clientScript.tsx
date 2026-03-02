import React from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import type { HadarsEntryModule } from '../types/ninety';
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

    // Seed the useServerData client cache from server-resolved values before
    // hydration so that hooks return the same data on the first render.
    if (props.__serverData && typeof props.__serverData === 'object') {
        initServerDataCache(props.__serverData as Record<string, unknown>);
        const { __serverData: _, ...rest } = props;
        props = rest;
    }

    const { location } = props;

    if ( appMod.getClientProps ) {
        props = await appMod.getClientProps(props);
    }

    props = {
        ...props,
        location,
    }

    const Component = appMod.default;

    const appEl = document.getElementById("app");
    if (appEl) {
        // In HMR mode the client component may have already changed since SSR,
        // so skip hydration to avoid mismatch warnings and do a fresh render.
        if ((module as any).hot) {
            createRoot(appEl).render(<Component {...props} />);
        } else {
            hydrateRoot(appEl, <Component {...props} />);
        }
    }
}

main();