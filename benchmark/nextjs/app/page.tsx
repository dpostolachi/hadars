// force-dynamic ensures every request hits the server — no RSC caching.
// This gives a fair comparison against hadars which always runs getInitProps.
export const dynamic = 'force-dynamic';

import { BenchPage } from '../../shared/BenchPage';
import { fetchPosts } from '../../shared/data';

export default async function Page() {
    const posts = await fetchPosts();
    const runtime = `Node.js ${process.version}`;
    return (
        <BenchPage
            posts={posts}
            serverTime={new Date().toISOString()}
            runtime={runtime}
        />
    );
}
