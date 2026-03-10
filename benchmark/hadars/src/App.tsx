import React from 'react';
import { HadarsContext, HadarsHead, type HadarsApp, type HadarsRequest } from 'hadars';
import { BenchPage } from '../../shared/BenchPage';
import { fetchPosts, type Post } from '../../shared/data';

interface Props {
    posts: Post[];
    serverTime: string;
    runtime: string;
}

const App: HadarsApp<Props> = ({ posts, serverTime, runtime, context }) => (
    <HadarsContext context={context}>
        <HadarsHead status={200}>
            <title>SSR Benchmark — hadars</title>
        </HadarsHead>
        <BenchPage posts={posts} serverTime={serverTime} runtime={runtime} />
    </HadarsContext>
);

export const getInitProps = async (_req: HadarsRequest): Promise<Props> => {
    const posts = await fetchPosts();
    const runtime =
        typeof (globalThis as any).Bun !== 'undefined'  ? `Bun ${(globalThis as any).Bun.version}` :
        typeof (globalThis as any).Deno !== 'undefined' ? `Deno ${(globalThis as any).Deno.version.deno}` :
        `Node.js ${process.version}`;
    return {
        posts,
        serverTime: new Date().toISOString(),
        runtime,
    };
};

export default App;
