export interface Post {
    id: number;
    title: string;
    body: string;
    author: string;
    date: string;
    tags: string[];
}

/** Simulates a 5ms database query — identical in both apps. */
export async function fetchPosts(): Promise<Post[]> {
    await new Promise(r => setTimeout(r, 5));
    return Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        title: `Understanding SSR patterns — part ${i + 1}`,
        body: `Server-side rendering gives users a faster initial page load by pre-rendering HTML on the server. This is post ${i + 1} of 20. It explores trade-offs between SSR, CSR, and static generation — each approach has merits depending on your performance requirements.`,
        author: ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'][i % 5]!,
        date: new Date(2024, i % 12, (i % 28) + 1).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
        }),
        tags: (['ssr', 'react', 'performance'] as const).slice(0, (i % 3) + 1) as string[],
    }));
}
