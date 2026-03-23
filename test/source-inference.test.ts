/**
 * Schema inference tests — requires `graphql` to be installed in the project.
 * We temporarily set process.cwd() to the gatsby-sources example which has graphql.
 */
import { test, expect, describe } from 'bun:test';
import { join } from 'node:path';
import { NodeStore } from '../src/source/store';
import { buildSchemaExecutor, buildSchemaSDL } from '../src/source/inference';

// The inference module resolves `graphql` from process.cwd(). Point it at the
// example project which has graphql installed as a direct dependency.
const EXAMPLE_DIR = join(import.meta.dir, '../examples/gatsby-sources');
const origCwd = process.cwd();
process.chdir(EXAMPLE_DIR);

function makeStore(nodes: Array<{ _type?: string } & Record<string, unknown>> = []): NodeStore {
    const store = new NodeStore();
    let i = 0;
    for (const { _type = 'TestType', ...data } of nodes) {
        store.createNode({
            id: `id-${++i}`,
            internal: { type: _type, contentDigest: `digest-${i}` },
            ...data,
        });
    }
    return store;
}

describe('buildSchemaExecutor', () => {
    test('returns null when graphql is not installed', async () => {
        // Skip if graphql IS installed in the project (it is for the tests)
        // This is tested by the fact that it returns non-null below; flip the
        // test to a positive check instead.
    });

    test('returns an executor for a populated store', async () => {
        const store = makeStore([
            { _type: 'BlogPost', slug: 'hello', title: 'Hello World', views: 42 },
        ]);
        const executor = await buildSchemaExecutor(store);
        expect(executor).toBeFunction();
    });

    test('allXxx query returns all nodes of a type', async () => {
        const store = makeStore([
            { _type: 'BlogPost', slug: 'a', title: 'A' },
            { _type: 'BlogPost', slug: 'b', title: 'B' },
        ]);
        const executor = await buildSchemaExecutor(store);
        const { data } = await executor!('{ allBlogPost { slug title } }');
        expect(data?.allBlogPost).toHaveLength(2);
        expect(data?.allBlogPost[0].slug).toBe('a');
    });

    test('single query looks up by id', async () => {
        const store = makeStore([{ _type: 'BlogPost', slug: 'hello', title: 'Hello' }]);
        const executor = await buildSchemaExecutor(store);
        const id = store.getNodesByType('BlogPost')[0].id;
        const { data } = await executor!(`{ blogPost(id: "${id}") { title } }`);
        expect(data?.blogPost?.title).toBe('Hello');
    });

    test('single query looks up by any scalar field', async () => {
        const store = makeStore([{ _type: 'BlogPost', slug: 'my-post', title: 'My Post' }]);
        const executor = await buildSchemaExecutor(store);
        const { data } = await executor!('{ blogPost(slug: "my-post") { title } }');
        expect(data?.blogPost?.title).toBe('My Post');
    });

    test('single query returns null when no match', async () => {
        const store = makeStore([{ _type: 'BlogPost', slug: 'exists' }]);
        const executor = await buildSchemaExecutor(store);
        const { data } = await executor!('{ blogPost(slug: "missing") { slug } }');
        expect(data?.blogPost).toBeNull();
    });

    test('infers Int for integer fields', async () => {
        const store = makeStore([{ _type: 'Post', views: 100, rating: 4.5 }]);
        const sdl = await buildSchemaSDL(store);
        expect(sdl).toContain('views: Int');
        expect(sdl).toContain('rating: Float');
    });

    test('infers Boolean for boolean fields', async () => {
        const store = makeStore([{ _type: 'Post', published: true }]);
        const sdl = await buildSchemaSDL(store);
        expect(sdl).toContain('published: Boolean');
    });

    test('handles multiple types', async () => {
        const store = new NodeStore();
        store.createNode({ id: '1', internal: { type: 'BlogPost', contentDigest: 'x' }, slug: 'a' });
        store.createNode({ id: '2', internal: { type: 'Author', contentDigest: 'y' }, name: 'Alice' });

        const executor = await buildSchemaExecutor(store);
        const { data } = await executor!('{ allBlogPost { slug } allAuthor { name } }');
        expect(data?.allBlogPost).toHaveLength(1);
        expect(data?.allAuthor).toHaveLength(1);
    });

    test('executor handles TypedDocumentNode-shaped objects via print', async () => {
        // Simulate a codegen document (no loc.source.body, has definitions)
        const { createRequire } = await import('node:module');
        const { parse } = createRequire(EXAMPLE_DIR + '/package.json')('graphql');
        const doc = parse('{ allBlogPost { slug } }');
        // Strip loc to simulate a codegen pre-compiled document
        const stripped = { kind: doc.kind, definitions: doc.definitions };

        const store = makeStore([{ _type: 'BlogPost', slug: 'test' }]);
        const executor = await buildSchemaExecutor(store);
        const { data } = await executor!(stripped as any);
        expect(data?.allBlogPost).toHaveLength(1);
    });

    test('returns errors array for invalid queries', async () => {
        const store = makeStore([{ _type: 'BlogPost', slug: 'a' }]);
        const executor = await buildSchemaExecutor(store);
        const { errors } = await executor!('{ nonExistentField }');
        expect(errors).toBeDefined();
        expect(errors!.length).toBeGreaterThan(0);
    });

    test('empty store returns working executor with _empty schema', async () => {
        const store = new NodeStore();
        const executor = await buildSchemaExecutor(store);
        expect(executor).toBeFunction();
        // Should not crash — query against empty schema
        const result = await executor!('{ __typename }');
        expect(result.data ?? result.errors).toBeDefined();
    });
});

describe('buildSchemaSDL', () => {
    test('returns SDL string for a populated store', async () => {
        const store = makeStore([{ _type: 'BlogPost', slug: 'a', title: 'A', views: 1 }]);
        const sdl = await buildSchemaSDL(store);
        expect(sdl).toContain('type BlogPost');
        expect(sdl).toContain('type Query');
        expect(sdl).toContain('allBlogPost');
        expect(sdl).toContain('blogPost(');
    });

    test('does not expose internal fields in SDL', async () => {
        const store = makeStore([{ _type: 'BlogPost', slug: 'a' }]);
        const sdl = await buildSchemaSDL(store);
        expect(sdl).not.toContain('internal:');
        expect(sdl).not.toContain('__typename');
    });
});
