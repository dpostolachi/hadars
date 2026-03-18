export interface Author {
    id: number;
    name: string;
    handle: string;
    bio: string;
    avatar: string;
    followers: number;
}

export interface Comment {
    id: number;
    author: string;
    avatar: string;
    body: string;
    likes: number;
    createdAt: string;
    replies: Array<{ id: number; author: string; body: string; likes: number }>;
}

export interface Post {
    id: number;
    title: string;
    excerpt: string;
    body: string[];
    author: Author;
    date: string;
    updatedAt: string;
    tags: string[];
    category: string;
    readingTime: number;
    views: number;
    likes: number;
    comments: Comment[];
    related: number[];
}

const AUTHORS: Author[] = [
    { id: 1, name: 'Alice Zhang',  handle: 'alicez',  bio: 'Senior engineer passionate about performance and DX. Writes about React, SSR, and web fundamentals.', avatar: 'AZ', followers: 12_400 },
    { id: 2, name: 'Bob Kaminski', handle: 'bobk',    bio: 'Full-stack developer, open-source maintainer. Focused on build tooling and server runtimes.',         avatar: 'BK', followers: 8_900  },
    { id: 3, name: 'Carol Oduya',  handle: 'carolo',  bio: 'Frontend architect at scale. Cares deeply about accessibility, CSS, and design systems.',             avatar: 'CO', followers: 21_000 },
    { id: 4, name: 'Dave Petrov',  handle: 'davep',   bio: 'Systems programmer turned web dev. Benchmarks everything. Hates unnecessary abstractions.',          avatar: 'DP', followers: 5_300  },
    { id: 5, name: 'Eve Nakamura', handle: 'even',    bio: 'Product engineer, TypeScript enthusiast. Blogs about developer experience and team velocity.',         avatar: 'EN', followers: 15_700 },
];

const CATEGORIES = ['Performance', 'Architecture', 'Tooling', 'Accessibility', 'TypeScript', 'DevOps', 'Testing', 'Design Systems'];

const TAG_POOL = ['ssr', 'react', 'performance', 'typescript', 'nextjs', 'bundling', 'css', 'a11y',
                  'node', 'bun', 'rspack', 'vite', 'testing', 'dx', 'devops', 'ci-cd'];

const PARA = [
    'Server-side rendering gives users a faster initial page load by pre-rendering HTML on the server before JavaScript is downloaded or executed. The browser can paint meaningful content almost immediately, reducing perceived latency dramatically.',
    'The trade-off between SSR, CSR, and static generation is nuanced. SSR excels when content is personalized or data is frequently updated, while static generation wins on pure cache efficiency. Client-side rendering remains the right default for highly interactive, authenticated dashboards.',
    'Modern bundlers like rspack and Vite have radically shortened build times. Incremental compilation, persistent caching, and Rust-native transforms mean that even large monorepos can rebuild in under a second -- a change that meaningfully impacts developer experience.',
    'Hydration remains the Achilles heel of SSR frameworks. Shipping a full virtual-DOM clone of the server-rendered HTML just to attach event listeners is wasteful. Partial hydration, islands architecture, and resumability are the competing answers the ecosystem is exploring.',
    'Edge computing moves SSR workloads geo-closer to users, cutting network round-trips from hundreds of milliseconds to single digits. The constraint is the reduced runtime surface -- no Node.js built-ins, limited CPU time, no long-lived memory -- which demands a different programming model.',
    'TypeScript has become table stakes for any serious frontend codebase. Beyond catching type errors, it serves as living documentation, enables safe large-scale refactoring, and integrates tightly with IDE tooling to accelerate development.',
    'Benchmarking web application performance is harder than it looks. Micro-benchmarks measure the wrong thing; synthetic load tests ignore real user behaviour; RUM captures noise from device diversity. The best signal combines all three, treated with appropriate scepticism.',
    'Caching is the single highest-leverage operation in backend performance. An in-memory LRU cache in front of an SSR renderer can turn a 50ms render into a sub-millisecond response for repeated requests, with automatic revalidation on TTL expiry.',
];

function makeComments(postId: number, count: number): Comment[] {
    return Array.from({ length: count }, (_, i) => {
        const a = AUTHORS[(postId + i) % AUTHORS.length]!;
        return {
            id:        postId * 100 + i,
            author:    a.name,
            avatar:    a.avatar,
            body:      PARA[(postId + i * 3) % PARA.length]!.slice(0, 120) + '...',
            likes:     ((postId * 7 + i * 13) % 80) + 1,
            createdAt: new Date(2024, (postId + i) % 12, ((postId + i) % 28) + 1)
                           .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
            replies: Array.from({ length: (i % 2) }, (_, j) => ({
                id:     postId * 1000 + i * 10 + j,
                author: AUTHORS[(postId + i + j + 1) % AUTHORS.length]!.name,
                body:   PARA[(postId + j) % PARA.length]!.slice(0, 80) + '...',
                likes:  ((postId + j) % 20) + 1,
            })),
        };
    });
}

/** Simulates a 5ms database query -- identical in both apps. */
export async function fetchPosts(): Promise<Post[]> {
    await new Promise(r => setTimeout(r, 5));
    return Array.from({ length: 40 }, (_, i) => {
        const author    = AUTHORS[i % AUTHORS.length]!;
        const tagCount  = (i % 3) + 2;
        const tags      = Array.from({ length: tagCount }, (_, j) => TAG_POOL[(i + j * 3) % TAG_POOL.length]!);
        const paraCount = (i % 2) + 1;
        const body      = Array.from({ length: paraCount }, (_, j) => PARA[(i + j) % PARA.length]!);
        return {
            id:          i + 1,
            title:       `${CATEGORIES[i % CATEGORIES.length]} deep-dive -- part ${i + 1}: patterns and trade-offs`,
            excerpt:     PARA[i % PARA.length]!.slice(0, 160) + '...',
            body,
            author,
            date:        new Date(2024, i % 12, (i % 28) + 1)
                             .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            updatedAt:   new Date(2025, (i + 2) % 12, (i % 28) + 1)
                             .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            tags,
            category:    CATEGORIES[i % CATEGORIES.length]!,
            readingTime: (i % 8) + 3,
            views:       ((i + 1) * 317) % 50_000 + 100,
            likes:       ((i + 1) * 43)  % 2_000  + 5,
            comments:    makeComments(i + 1, (i % 2) + 2),
            related:     [((i + 3) % 100) + 1, ((i + 7) % 100) + 1, ((i + 13) % 100) + 1],
        };
    });
}
