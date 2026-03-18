import React from 'react';
import type { Post, Author } from './data';

interface Props {
    posts: Post[];
    serverTime: string;
    runtime: string;
}

// -- small reusable pieces --

function Avatar({ initials, size = 36 }: { initials: string; size?: number }) {
    return (
        <div style={{
            width: size, height: size, borderRadius: '50%',
            background: '#6366f1', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
        }}>{initials}</div>
    );
}

function Tag({ label }: { label: string }) {
    return (
        <span style={{
            padding: '0.15rem 0.55rem', background: '#e0e7ff', color: '#4338ca',
            borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 600,
        }}>#{label}</span>
    );
}

function AuthorCard({ author }: { author: Author }) {
    return (
        <div style={{
            display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
            padding: '0.75rem', background: '#f5f3ff', borderRadius: 8, marginTop: '0.75rem',
        }}>
            <Avatar initials={author.avatar} size={44} />
            <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{author.name}</div>
                <div style={{ color: '#7c3aed', fontSize: '0.78rem', marginBottom: '0.25rem' }}>@{author.handle}</div>
                <div style={{ fontSize: '0.82rem', color: '#4b5563', lineHeight: 1.5 }}>{author.bio}</div>
                <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
                    {author.followers.toLocaleString()} followers
                </div>
            </div>
        </div>
    );
}

function CommentThread({ comments }: { comments: Post['comments'] }) {
    return (
        <div style={{ marginTop: '1rem' }}>
            <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.75rem', color: '#374151' }}>
                {comments.length} comment{comments.length !== 1 ? 's' : ''}
            </h4>
            {comments.map(c => (
                <div key={c.id} style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                        <Avatar initials={c.avatar} size={28} />
                        <div style={{ flex: 1, background: '#f9fafb', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{c.author}</span>
                                <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{c.createdAt}</span>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.55, color: '#374151' }}>{c.body}</p>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.35rem' }}>
                                likes: {c.likes}
                            </div>
                        </div>
                    </div>
                    {c.replies.length > 0 && (
                        <div style={{ marginLeft: '2.4rem', marginTop: '0.5rem' }}>
                            {c.replies.map(r => (
                                <div key={r.id} style={{
                                    background: '#f3f4f6', borderRadius: 6,
                                    padding: '0.4rem 0.6rem', marginBottom: '0.35rem',
                                    fontSize: '0.82rem', color: '#374151',
                                }}>
                                    <strong>{r.author}</strong>: {r.body}
                                    <span style={{ color: '#9ca3af', marginLeft: '0.5rem' }}>likes: {r.likes}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

function PostCard({ post }: { post: Post }) {
    return (
        <article style={{
            marginBottom: '2rem', padding: '1.5rem',
            border: '1px solid #e5e7eb', borderRadius: 10,
            background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        }}>
            <div style={{ marginBottom: '0.6rem' }}>
                <span style={{
                    fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: '#6366f1',
                }}>{post.category}</span>
            </div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', lineHeight: 1.4, color: '#111827' }}>
                {post.title}
            </h3>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#6b7280', lineHeight: 1.55 }}>
                {post.excerpt}
            </p>
            {post.body.map((para, i) => (
                <p key={i} style={{ margin: '0 0 0.65rem', fontSize: '0.88rem', lineHeight: 1.7, color: '#374151' }}>
                    {para}
                </p>
            ))}
            <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '0.5rem',
                alignItems: 'center', margin: '0.75rem 0',
                fontSize: '0.8rem', color: '#9ca3af',
            }}>
                <span>published: {post.date}</span>
                <span>updated: {post.updatedAt}</span>
                <span>{post.readingTime} min read</span>
                <span>{post.views.toLocaleString()} views</span>
                <span>{post.likes.toLocaleString()} likes</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
                {post.tags.map(t => <Tag key={t} label={t} />)}
            </div>
            <AuthorCard author={post.author} />
            <CommentThread comments={post.comments} />
        </article>
    );
}

function Sidebar({ posts }: { posts: Post[] }) {
    const totalViews    = posts.reduce((s, p) => s + p.views,    0);
    const totalLikes    = posts.reduce((s, p) => s + p.likes,    0);
    const totalComments = posts.reduce((s, p) => s + p.comments.length, 0);

    const tagCounts: Record<string, number> = {};
    for (const p of posts) for (const t of p.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);

    const byCategory: Record<string, number> = {};
    for (const p of posts) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;

    return (
        <aside style={{ width: 260, flexShrink: 0 }}>
            <div style={{ padding: '1rem', background: '#f5f3ff', borderRadius: 10, marginBottom: '1.25rem' }}>
                <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 700, color: '#4338ca' }}>Site stats</h3>
                {([
                    ['Posts',        posts.length.toLocaleString()],
                    ['Total views',  totalViews.toLocaleString()],
                    ['Total likes',  totalLikes.toLocaleString()],
                    ['Comments',     totalComments.toLocaleString()],
                ] as [string, string][]).map(([label, value]) => (
                    <div key={label} style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: '0.82rem', padding: '0.25rem 0',
                        borderBottom: '1px solid #ede9fe',
                    }}>
                        <span style={{ color: '#6b7280' }}>{label}</span>
                        <strong>{value}</strong>
                    </div>
                ))}
            </div>
            <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: 10, marginBottom: '1.25rem' }}>
                <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 700 }}>Popular tags</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {topTags.map(([tag, count]) => (
                        <span key={tag} style={{
                            padding: '0.15rem 0.5rem', background: '#e0e7ff',
                            color: '#4338ca', borderRadius: '9999px',
                            fontSize: '0.75rem', fontWeight: 600,
                        }}>#{tag} ({count})</span>
                    ))}
                </div>
            </div>
            <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: 10 }}>
                <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 700 }}>Categories</h3>
                {Object.entries(byCategory).map(([cat, n]) => (
                    <div key={cat} style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: '0.82rem', padding: '0.2rem 0',
                    }}>
                        <span>{cat}</span>
                        <span style={{ color: '#9ca3af' }}>{n}</span>
                    </div>
                ))}
            </div>
        </aside>
    );
}

export function BenchPage({ posts, serverTime, runtime }: Props) {
    const topPost = [...posts].sort((a, b) => b.views - a.views)[0]!;

    return (
        <div style={{ fontFamily: 'system-ui, sans-serif', background: '#f3f4f6', minHeight: '100vh' }}>
            <nav style={{
                background: '#4f46e5', color: '#fff',
                padding: '0.75rem 2rem',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>BenchBlog</span>
                <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>Rendered at {serverTime} - {runtime}</span>
            </nav>

            <div style={{
                background: '#4f46e5', color: '#fff', padding: '2.5rem 2rem', marginBottom: '2rem',
            }}>
                <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                    <div style={{ fontSize: '0.75rem', opacity: 0.75, marginBottom: '0.4rem' }}>
                        Top article - {topPost.views.toLocaleString()} views
                    </div>
                    <h1 style={{ margin: '0 0 0.6rem', fontSize: '1.8rem', lineHeight: 1.25 }}>{topPost.title}</h1>
                    <p style={{ margin: '0 0 1rem', opacity: 0.85, maxWidth: 640, lineHeight: 1.6 }}>{topPost.excerpt}</p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {topPost.tags.map(t => (
                            <span key={t} style={{
                                padding: '0.2rem 0.6rem', background: 'rgba(255,255,255,0.2)',
                                borderRadius: '9999px', fontSize: '0.75rem',
                            }}>#{t}</span>
                        ))}
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 1.5rem 3rem', display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>
                <main style={{ flex: 1, minWidth: 0 }}>
                    <h2 style={{ fontSize: '1.1rem', margin: '0 0 1.25rem', color: '#374151' }}>
                        {posts.length} articles
                    </h2>
                    {posts.map(post => <PostCard key={post.id} post={post} />)}
                </main>
                <Sidebar posts={posts} />
            </div>

            <footer style={{
                background: '#1f2937', color: '#9ca3af',
                padding: '1.5rem 2rem', fontSize: '0.8rem', textAlign: 'center',
            }}>
                hadars vs Next.js SSR benchmark - {posts.length} posts -{' '}
                {posts.reduce((s, p) => s + p.comments.length, 0)} comments rendered
            </footer>
        </div>
    );
}
