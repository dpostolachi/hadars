import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HadarsOptions, HadarsStaticContext } from 'hadars';
import * as postsSource from './src/posts-source';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default {
    entry: './src/index.tsx',

    sources: [
        // Gatsby source plugin — creates File/Directory nodes from the content dir
        {
            resolve: 'gatsby-source-filesystem',
            options: {
                name: 'content',
                path: resolve(__dirname, 'content'),
            },
        },
        // Local source plugin — creates BlogPost nodes from posts.json
        {
            resolve: postsSource,
            options: {
                contentDir: resolve(__dirname, 'content'),
            },
        },
    ],

    paths: async ({ graphql }: HadarsStaticContext) => {
        const { data } = await graphql(`{ allBlogPost { slug } }`);
        const slugs: string[] = (data?.allBlogPost ?? []).map((p: any) => p.slug);
        return ['/', ...slugs.map(s => `/post/${s}`)];
    },
} satisfies HadarsOptions;
