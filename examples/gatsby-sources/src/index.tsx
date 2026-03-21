import React from 'react';
import type { HadarsApp, HadarsRequest, HadarsStaticContext } from 'hadars';
import { HadarsHead } from 'hadars';

interface Post {
    id: string;
    slug: string;
    title: string;
    date: string;
    author: string;
    excerpt: string;
    body: string;
}

interface Props {
    posts: Post[];
    currentPost?: Post | null;
}

// ── Post list ─────────────────────────────────────────────────────────────────

const PostCard: React.FC<{ post: Post }> = ({ post }) => (
    <article style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 20, marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px' }}>
            <a href={`/post/${post.slug}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                {post.title}
            </a>
        </h2>
        <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 10px' }}>
            {post.date} · {post.author}
        </p>
        <p style={{ margin: 0, color: '#374151' }}>{post.excerpt}</p>
    </article>
);

const PostList: React.FC<{ posts: Post[] }> = ({ posts }) => (
    <main style={{ maxWidth: 680, margin: '0 auto', padding: '40px 20px' }}>
        <h1 style={{ marginBottom: 8 }}>hadars × Gatsby sources</h1>
        <p style={{ color: '#64748b', marginBottom: 32 }}>
            Posts sourced from <code>content/posts.json</code> via a Gatsby-compatible source plugin.
            GraphiQL is available at{' '}
            <a href="/__hadars/graphql" style={{ color: '#2563eb' }}>/__hadars/graphql</a>{' '}
            in dev mode.
        </p>
        {posts.map(p => <PostCard key={p.id} post={p} />)}
    </main>
);

// ── Single post ───────────────────────────────────────────────────────────────

const PostPage: React.FC<{ post: Post }> = ({ post }) => (
    <main style={{ maxWidth: 680, margin: '0 auto', padding: '40px 20px' }}>
        <p style={{ marginBottom: 24 }}>
            <a href="/" style={{ color: '#2563eb' }}>← All posts</a>
        </p>
        <h1 style={{ marginBottom: 4 }}>{post.title}</h1>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 32 }}>
            {post.date} · {post.author}
        </p>
        <p style={{ lineHeight: 1.7, color: '#374151' }}>{post.body}</p>
    </main>
);

// ── App ───────────────────────────────────────────────────────────────────────

const App: HadarsApp<Props> = ({ posts, currentPost }) => {
    const title = currentPost ? `${currentPost.title} — Blog` : 'Blog — hadars sources example';
    return (
        <>
            <HadarsHead status={200}>
                <title>{title}</title>
            </HadarsHead>
            {currentPost ? <PostPage post={currentPost} /> : <PostList posts={posts} />}
        </>
    );
};

// ── Data fetching ─────────────────────────────────────────────────────────────

export const getInitProps = async (
    req: HadarsRequest,
    ctx?: HadarsStaticContext,
): Promise<Props> => {
    // Only available when ctx is provided (static export or dev with sources)
    const graphql = ctx?.graphql;

    if (!graphql) {
        return { posts: [] };
    }

    // Check if this is a post page
    const match = req.pathname.match(/^\/post\/([^/]+)$/);
    if (match) {
        const slug = match[1]!;
        const { data } = await graphql(
            `query($slug: String) { blogPost(slug: $slug) { id slug title date author body } }`,
            { slug },
        );
        return { posts: [], currentPost: data?.blogPost ?? null };
    }

    // Index page — fetch all posts
    const { data } = await graphql(`{
        allBlogPost { id slug title date author excerpt body }
    }`);
    return { posts: data?.allBlogPost ?? [] };
};

export default App;
