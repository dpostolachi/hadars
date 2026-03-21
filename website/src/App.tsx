import React from 'react';
import { Routes, Route, BrowserRouter, StaticRouter } from 'react-router-dom';
import { type HadarsApp, type HadarsRequest } from 'hadars';
import { dehydrate, hydrate, QueryClient, QueryClientProvider, type DehydratedState } from '@tanstack/react-query';

import Layout from './components/Layout';
import Home, { type HomeProps } from './pages/Home';
import GettingStarted from './pages/docs/GettingStarted';
import ApiReference from './pages/docs/ApiReference';
import HeadManagement from './pages/docs/HeadManagement';
import DataFetching from './pages/docs/DataFetching';
import Routing from './pages/docs/Routing';
import SlimReact from './pages/docs/SlimReact';
import Deployment from './pages/docs/Deployment';
import CloudflareDeployment from './pages/docs/CloudflareDeployment';
import FromNextjs from './pages/docs/FromNextjs';
import CacheTest from './pages/CacheTest';
import DataDemo from './pages/DataDemo';

interface PageProps extends HomeProps {
    rcClient?: QueryClient;
    cache?: DehydratedState;
}

const AppRoutes: React.FC<PageProps> = (props) => (
    <Layout>
        <Routes>
            <Route path="/" element={<Home {...props} />} />
            <Route path="/docs/getting-started" element={<GettingStarted />} />
            <Route path="/docs/routing" element={<Routing />} />
            <Route path="/docs/api" element={<ApiReference />} />
            <Route path="/docs/head" element={<HeadManagement />} />
            <Route path="/docs/data" element={<DataFetching />} />
            <Route path="/docs/slim-react" element={<SlimReact />} />
            <Route path="/docs/deployment" element={<Deployment />} />
            <Route path="/docs/from-nextjs" element={<FromNextjs />} />
            <Route path="/docs/cloudflare" element={<CloudflareDeployment />} />
            <Route path="/cache-test" element={<CacheTest serverTime={props.serverTime} />} />
            <Route path="/data-demo" element={<DataDemo />} />
        </Routes>
    </Layout>
);

const App: HadarsApp<PageProps> = (props) => {
    const { location, rcClient, ...rest } = props;

    const inner = (
        <QueryClientProvider client={rcClient!}>
            <AppRoutes rcClient={rcClient} {...rest} />
        </QueryClientProvider>
    );

    // Use StaticRouter during SSR, BrowserRouter on the client.
    // Both resolve to the same route/DOM for the same URL, so hydration is clean.
    if (typeof window === 'undefined') {
        return <StaticRouter location={location}>{inner}</StaticRouter>;
    }
    return <BrowserRouter>{inner}</BrowserRouter>;
};

export const getInitProps = async (_req: HadarsRequest): Promise<PageProps> => {
    const runtime =
        typeof (globalThis as any).Bun !== 'undefined' ? `Bun ${(globalThis as any).Bun.version}` :
        typeof (globalThis as any).Deno !== 'undefined' ? `Deno ${(globalThis as any).Deno.version.deno}` :
        `Node.js ${(globalThis as any).process?.version ?? ''}`;

    return {
        serverTime: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' }),
        bunVersion: runtime,
        rcClient: new QueryClient(),
    };
};

export const getFinalProps = async ({ rcClient, ...props }: Partial<PageProps>): Promise<Partial<PageProps>> => {
    const cache = dehydrate(rcClient as QueryClient);
    return { ...props, cache };
};

export const getClientProps = async (props: Partial<PageProps>): Promise<Partial<PageProps>> => {
    const rcClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    hydrate(rcClient, props.cache as DehydratedState);
    return { ...props, rcClient };
};

export default App;
