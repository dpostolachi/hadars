import { test, expect, describe } from 'bun:test';
import { runSources } from '../src/source/runner';
import type { HadarsSourceEntry } from '../src/types/hadars';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a source entry from a module object. */
function entry(
    mod: { sourceNodes: (ctx: any, opts?: any) => void | Promise<void> },
    options: Record<string, unknown> = {},
): HadarsSourceEntry {
    return { resolve: mod, options };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runSources', () => {
    test('runs a synchronous source plugin and returns the node store', async () => {
        const plugin = {
            sourceNodes({ actions, createNodeId, createContentDigest }: any) {
                actions.createNode({
                    id: createNodeId('post-1'),
                    title: 'Hello',
                    internal: { type: 'BlogPost', contentDigest: createContentDigest('post-1') },
                });
            },
        };

        const store = await runSources([entry(plugin)]);
        expect(store.getNodesByType('BlogPost')).toHaveLength(1);
        expect((store.getNodesByType('BlogPost')[0] as any).title).toBe('Hello');
    });

    test('runs multiple plugins and merges results into one store', async () => {
        const pluginA = {
            sourceNodes({ actions, createNodeId, createContentDigest }: any) {
                actions.createNode({
                    id: createNodeId('post-1'),
                    internal: { type: 'BlogPost', contentDigest: createContentDigest('1') },
                });
            },
        };
        const pluginB = {
            sourceNodes({ actions, createNodeId, createContentDigest }: any) {
                actions.createNode({
                    id: createNodeId('author-1'),
                    internal: { type: 'Author', contentDigest: createContentDigest('1') },
                });
            },
        };

        const store = await runSources([entry(pluginA), entry(pluginB)]);
        expect(store.getNodesByType('BlogPost')).toHaveLength(1);
        expect(store.getNodesByType('Author')).toHaveLength(1);
    });

    test('handles async source plugins', async () => {
        const plugin = {
            async sourceNodes({ actions, createNodeId, createContentDigest }: any) {
                await new Promise(r => setTimeout(r, 10));
                actions.createNode({
                    id: createNodeId('async-1'),
                    internal: { type: 'Post', contentDigest: createContentDigest('async-1') },
                });
            },
        };

        const store = await runSources([entry(plugin)]);
        expect(store.getNodesByType('Post')).toHaveLength(1);
    });

    test('skips plugins without sourceNodes and logs a warning', async () => {
        const warnings: string[] = [];
        const orig = console.warn;
        console.warn = (m: string) => warnings.push(m);

        try {
            const plugin = { notSourceNodes: () => {} };
            const store = await runSources([{ resolve: plugin as any }]);
            expect(store.getNodes()).toHaveLength(0);
            expect(warnings.some(w => w.includes('sourceNodes'))).toBe(true);
        } finally {
            console.warn = orig;
        }
    });

    test('wraps sourceNodes errors with plugin name', async () => {
        const plugin = {
            sourceNodes() {
                throw new Error('something went wrong');
            },
        };

        await expect(runSources([entry(plugin)])).rejects.toThrow('hadars-source');
        await expect(runSources([entry(plugin)])).rejects.toThrow('something went wrong');
    });

    test('preserves original error as cause', async () => {
        const original = new Error('root cause');
        const plugin = { sourceNodes() { throw original; } };

        let caught: any;
        try {
            await runSources([entry(plugin)]);
        } catch (err) {
            caught = err;
        }
        expect(caught?.cause).toBe(original);
    });

    test('nodes created after an async delay are captured (settle logic)', async () => {
        const plugin = {
            sourceNodes({ actions, createNodeId, createContentDigest }: any) {
                // Simulate chokidar-style delayed node creation
                setTimeout(() => {
                    actions.createNode({
                        id: createNodeId('delayed'),
                        internal: { type: 'Post', contentDigest: createContentDigest('delayed') },
                    });
                }, 100);
            },
        };

        const store = await runSources([entry(plugin)]);
        expect(store.getNodesByType('Post')).toHaveLength(1);
    }, 15_000);

    test('nodes created on BOOTSTRAP_FINISHED are captured', async () => {
        const plugin = {
            sourceNodes({ actions, createNodeId, createContentDigest, emitter }: any) {
                (emitter as import('node:events').EventEmitter).once('BOOTSTRAP_FINISHED', () => {
                    actions.createNode({
                        id: createNodeId('post-bootstrap'),
                        internal: { type: 'Extra', contentDigest: createContentDigest('pb') },
                    });
                });
            },
        };

        const store = await runSources([entry(plugin)]);
        expect(store.getNodesByType('Extra')).toHaveLength(1);
    }, 15_000);

    test('passes options to sourceNodes', async () => {
        let receivedOptions: any;
        const plugin = {
            sourceNodes(_ctx: any, opts: any) {
                receivedOptions = opts;
            },
        };

        await runSources([entry(plugin, { path: '/content', name: 'posts' })]);
        expect(receivedOptions).toEqual({ path: '/content', name: 'posts' });
    });

    test('returns empty store for empty sources array', async () => {
        const store = await runSources([]);
        expect(store.getNodes()).toHaveLength(0);
        expect(store.getTypes()).toHaveLength(0);
    });
});
