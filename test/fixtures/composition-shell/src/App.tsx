import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { useState } from 'react';
import { provideShared, registerModule, useModule, loadServerModule, loadClientModule } from 'hadars/composition';

// What every module in the composition renders against. On the server `react`
// resolves to the SSR renderer's React, in the browser to the real one.
provideShared({ react: React, 'react/jsx-runtime': jsxRuntime });

export const getInitProps = async () => {
    registerModule('greeter', await loadServerModule(`${process.env.MODULE_DIR}/server`));
    return {};
};

export const getClientProps = async (props: object) => {
    // Must finish before hydration so the first client render matches the server HTML.
    registerModule('greeter', await loadClientModule('greeter', '/w/greeter'));
    return props;
};

export default function App() {
    const { greeting } = useModule('greeter');
    const [count, setCount] = useState(0);
    return (
        <div>
            <h1 id="shell">shell</h1>
            <button id="inc" onClick={() => setCount((c) => c + 1)}>shell count {count}</button>
            <greeting.Ctx.Provider value="host">
                <greeting.Greeting />
            </greeting.Ctx.Provider>
        </div>
    );
}
