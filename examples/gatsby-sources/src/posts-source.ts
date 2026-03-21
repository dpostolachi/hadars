/**
 * Local source plugin — reads posts.json and creates BlogPost nodes.
 * Follows the Gatsby sourceNodes API exactly so it could be extracted to npm.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface RawPost {
    slug: string;
    title: string;
    date: string;
    author: string;
    excerpt: string;
    body: string;
}

export async function sourceNodes(
    { actions, createNodeId, createContentDigest, reporter }: any,
    options: { contentDir?: string } = {},
) {
    const { createNode } = actions;
    const dir = options.contentDir ?? resolve(process.cwd(), 'content');

    reporter.info(`Reading posts from ${dir}/posts.json`);

    const raw = await readFile(resolve(dir, 'posts.json'), 'utf-8');
    const posts: RawPost[] = JSON.parse(raw);

    for (const post of posts) {
        createNode({
            ...post,
            id: createNodeId(post.slug),
            internal: {
                type: 'BlogPost',
                contentDigest: createContentDigest(post),
            },
        });
    }

    reporter.info(`Created ${posts.length} BlogPost nodes`);
}
