import React from 'react';
import { Routes, Route, Link, useParams, BrowserRouter, StaticRouter } from 'react-router-dom';
import type { HadarsApp, HadarsRequest } from 'hadars';
import { HadarsHead, useGraphQL } from 'hadars';
import { graphql as gql } from './gql/gql';
import PostCard from './PostCard';

// Spread the fragment — codegen ensures GetAllPosts includes exactly what PostCard needs.
const GetPostDocument = gql(`query GetPost($slug: String) { blogPost(slug: $slug) { id slug title date author body } }`);
const GetAllPostsDocument = gql(`query GetAllPosts { allBlogPost { ...PostCard } }`);

// ── Post list ─────────────────────────────────────────────────────────────────

const PostList: React.FC = () => {
    const result = useGraphQL(GetAllPostsDocument);
    const posts = result?.data?.allBlogPost ?? [];

    return (
        <main style={{ maxWidth: 680, margin: '0 auto', padding: '40px 20px' }}>
            <HadarsHead status={200}><title>Blog — hadars sources example</title></HadarsHead>
            <h1 style={{ marginBottom: 8 }}>hadars × Gatsby sources</h1>
            <p style={{ color: '#64748b', marginBottom: 32 }}>
                Posts sourced from <code>content/posts.json</code> via a Gatsby-compatible source plugin.
                GraphiQL is available at{' '}
                <a href="/__hadars/graphql" style={{ color: '#2563eb' }}>/__hadars/graphql</a>{' '}
                in dev mode.
            </p>
            {posts.map((post, i) => (
                // post is FragmentType<typeof PostCardFragment> — PostCard unmasks it.
                <PostCard key={i} post={post} />
            ))}
        </main>
    );
};

// ── Single post ───────────────────────────────────────────────────────────────

const PostPage: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const result = useGraphQL(GetPostDocument, { slug });
    const post = result?.data?.blogPost;

    if (!post) {
        return (
            <main style={{ maxWidth: 680, margin: '0 auto', padding: '40px 20px' }}>
                <HadarsHead status={404}><title>Not found</title></HadarsHead>
                <Link to="/" style={{ color: '#2563eb' }}>← All posts</Link>
                <p style={{ marginTop: 24, color: '#64748b' }}>Post not found.</p>
            </main>
        );
    }

    return (
        <main style={{ maxWidth: 680, margin: '0 auto', padding: '40px 20px' }}>
            <HadarsHead status={200}><title>{post.title} — Blog</title></HadarsHead>
            <p style={{ marginBottom: 24 }}>
                <Link to="/" style={{ color: '#2563eb' }}>← All posts</Link>
            </p>
            <h1 style={{ marginBottom: 4 }}>{post.title}</h1>
            <p style={{ color: '#64748b', fontSize: 13, marginBottom: 32 }}>
                {post.date} · {post.author}
            </p>
            <p style={{ lineHeight: 1.7, color: '#374151' }}>{post.body}</p>
        </main>
    );
};

// ── App ───────────────────────────────────────────────────────────────────────

const AppRoutes: React.FC = () => (
    <Routes>
        <Route path="/" element={<PostList />} />
        <Route path="/post/:slug" element={<PostPage />} />
    </Routes>
);

const App: HadarsApp<{}> = ({ location }) => {
    if (typeof window === 'undefined') {
        return <StaticRouter location={location}><AppRoutes /></StaticRouter>;
    }
    return <BrowserRouter><AppRoutes /></BrowserRouter>;
};

export const getInitProps = async (_req: HadarsRequest): Promise<{}> => ({});

export default App;
