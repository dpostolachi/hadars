import React from 'react';
import type { Post } from './data';

interface Props {
    posts: Post[];
    serverTime: string;
    runtime: string;
}

export function BenchPage({ posts, serverTime, runtime }: Props) {
    return (
        <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '860px', margin: '0 auto', padding: '2rem' }}>
            <header style={{ marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '2px solid #e5e7eb' }}>
                <h1 style={{ fontSize: '2rem', margin: '0 0 0.5rem' }}>SSR Benchmark Page</h1>
                <p style={{ margin: 0, color: '#6b7280' }}>
                    Rendered at <strong>{serverTime}</strong> · Runtime: <strong>{runtime}</strong>
                </p>
            </header>

            <section>
                <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>{posts.length} Posts</h2>
                {posts.map(post => (
                    <article
                        key={post.id}
                        style={{
                            marginBottom: '1.5rem',
                            padding: '1.25rem',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                            background: '#fafafa',
                        }}
                    >
                        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>{post.title}</h3>
                        <p style={{ margin: '0 0 0.75rem', lineHeight: 1.65, color: '#374151' }}>{post.body}</p>
                        <footer style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', fontSize: '0.85rem', color: '#9ca3af' }}>
                            <strong style={{ color: '#6b7280' }}>{post.author}</strong>
                            <span>·</span>
                            <span>{post.date}</span>
                            {post.tags.map(tag => (
                                <span
                                    key={tag}
                                    style={{
                                        padding: '0.1rem 0.5rem',
                                        background: '#e5e7eb',
                                        borderRadius: '9999px',
                                        fontSize: '0.75rem',
                                    }}
                                >
                                    #{tag}
                                </span>
                            ))}
                        </footer>
                    </article>
                ))}
            </section>

            <footer style={{ marginTop: '2rem', padding: '1rem 0', borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontSize: '0.8rem' }}>
                hadars vs Next.js SSR benchmark · {posts.length} items rendered
            </footer>
        </main>
    );
}
