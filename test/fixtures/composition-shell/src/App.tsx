import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as jsxDevRuntime from 'react/jsx-dev-runtime';
import { useState } from 'react';
import type { HadarsRequest } from 'hadars';
import type { PinnedBuild } from 'hadars/composition';
import { provideShared, registerModule, getModule, loadServerModule, loadClientModule, ModuleHead } from 'hadars/composition';

// What every module in the composition renders against. On the server `react`
// resolves to the SSR renderer's React, in the browser to the real one.
provideShared({ react: React, 'react/jsx-runtime': jsxRuntime, 'react/jsx-dev-runtime': jsxDevRuntime });

export const getInitProps = async (req: HadarsRequest) => {
    const build = req.pinnedBuilds?.greeter;
    if (build) {
        registerModule('greeter', await loadServerModule(build.server));
        return { moduleBase: build.client.baseUrl, client: build.client };
    }
    registerModule('greeter', await loadServerModule(process.env.MODULE_SERVER_DIR ?? `${process.env.MODULE_DIR}/server`));
    // A module run locally is loaded from its own dev server instead of the shell's origin.
    return { moduleBase: process.env.MODULE_URL ?? '/w/greeter' };
};

export const getClientProps = async (props: { moduleBase: string; client?: PinnedBuild['client'] }) => {
    // Must finish before hydration so the first client render matches the server HTML.
    registerModule('greeter', await loadClientModule('greeter', props.moduleBase, { crossOrigin: 'anonymous', ...props.client }));
    return props;
};

export default function App({ client }: { client?: PinnedBuild['client'] }) {
    const { greeting } = getModule('greeter');
    const [count, setCount] = useState(0);
    return (
        <div>
            {client && <ModuleHead client={client} />}
            <h1 id="shell">shell</h1>
            <button id="inc" onClick={() => setCount((c) => c + 1)}>shell count {count}</button>
            <greeting.Ctx.Provider value="host">
                <greeting.Greeting />
            </greeting.Ctx.Provider>
        </div>
    );
}
