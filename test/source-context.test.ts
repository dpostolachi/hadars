import { test, expect, describe } from 'bun:test';
import { makeGatsbyContext } from '../src/source/context';
import { NodeStore } from '../src/source/store';
import { EventEmitter } from 'node:events';

function makeStore() { return new NodeStore(); }

describe('makeGatsbyContext', () => {
    test('createNodeId produces stable sha256 hex for same input', () => {
        const ctx = makeGatsbyContext(makeStore(), 'test-plugin');
        const id1 = ctx.createNodeId('hello');
        const id2 = ctx.createNodeId('hello');
        expect(id1).toBe(id2);
        expect(id1).toMatch(/^[0-9a-f]{64}$/);
    });

    test('createNodeId differs across plugin names (namespaced)', () => {
        const ctxA = makeGatsbyContext(makeStore(), 'plugin-a');
        const ctxB = makeGatsbyContext(makeStore(), 'plugin-b');
        expect(ctxA.createNodeId('same')).not.toBe(ctxB.createNodeId('same'));
    });

    test('createContentDigest returns md5 hex for strings', () => {
        const ctx = makeGatsbyContext(makeStore(), 'p');
        const digest = ctx.createContentDigest('hello');
        expect(digest).toMatch(/^[0-9a-f]{32}$/);
        expect(ctx.createContentDigest('hello')).toBe(digest);
    });

    test('createContentDigest handles objects', () => {
        const ctx = makeGatsbyContext(makeStore(), 'p');
        const d1 = ctx.createContentDigest({ a: 1 });
        const d2 = ctx.createContentDigest({ a: 1 });
        expect(d1).toBe(d2);
        expect(ctx.createContentDigest({ a: 2 })).not.toBe(d1);
    });

    test('actions.createNode writes to store', () => {
        const store = makeStore();
        const ctx = makeGatsbyContext(store, 'p');
        ctx.actions.createNode({
            id: ctx.createNodeId('post-1'),
            internal: { type: 'BlogPost', contentDigest: ctx.createContentDigest('post-1') },
            title: 'Hello',
        });
        expect(store.getNodesByType('BlogPost')).toHaveLength(1);
    });

    test('getNode / getNodes / getNodesByType proxy the store', () => {
        const store = makeStore();
        const nodeId = 'fixed-id';
        store.createNode({ id: nodeId, internal: { type: 'T', contentDigest: 'x' } });
        const ctx = makeGatsbyContext(store, 'p');
        expect(ctx.getNode(nodeId)).toBeDefined();
        expect(ctx.getNodes()).toHaveLength(1);
        expect(ctx.getNodesByType('T')).toHaveLength(1);
    });

    test('cache get/set is per plugin instance', async () => {
        const ctxA = makeGatsbyContext(makeStore(), 'a');
        const ctxB = makeGatsbyContext(makeStore(), 'b');
        await ctxA.cache.set('key', 'value-a');
        expect(await ctxA.cache.get('key')).toBe('value-a');
        expect(await ctxB.cache.get('key')).toBeUndefined();
    });

    test('accepts external emitter', () => {
        const emitter = new EventEmitter();
        const ctx = makeGatsbyContext(makeStore(), 'p', {}, emitter);
        expect(ctx.emitter).toBe(emitter);
    });

    test('actions.deleteNode logs a warning', () => {
        const messages: string[] = [];
        const orig = console.warn;
        console.warn = (m: string) => messages.push(m);
        try {
            const ctx = makeGatsbyContext(makeStore(), 'p');
            ctx.actions.deleteNode({ id: 'x' });
            expect(messages.some(m => m.includes('deleteNode') && m.includes('"x"'))).toBe(true);
        } finally {
            console.warn = orig;
        }
    });
});
