import { test, expect, describe } from 'bun:test';
import { NodeStore } from '../src/source/store';
import type { HadarsNode } from '../src/source/store';

function makeNode(overrides: Partial<HadarsNode> = {}): HadarsNode {
    return {
        id: 'node-1',
        internal: { type: 'TestType', contentDigest: 'abc123' },
        ...overrides,
    };
}

describe('NodeStore', () => {
    test('createNode stores and retrieves by id', () => {
        const store = new NodeStore();
        const node = makeNode();
        store.createNode(node);
        expect(store.getNode('node-1')).toEqual(node);
    });

    test('createNode stores by type', () => {
        const store = new NodeStore();
        store.createNode(makeNode({ id: 'a', internal: { type: 'BlogPost', contentDigest: 'x' } }));
        store.createNode(makeNode({ id: 'b', internal: { type: 'BlogPost', contentDigest: 'y' } }));
        store.createNode(makeNode({ id: 'c', internal: { type: 'File', contentDigest: 'z' } }));

        expect(store.getNodesByType('BlogPost')).toHaveLength(2);
        expect(store.getNodesByType('File')).toHaveLength(1);
        expect(store.getNodesByType('Unknown')).toHaveLength(0);
    });

    test('createNode replaces existing node with same id', () => {
        const store = new NodeStore();
        store.createNode(makeNode({ title: 'v1' } as any));
        store.createNode(makeNode({ title: 'v2' } as any));

        const nodes = store.getNodesByType('TestType');
        expect(nodes).toHaveLength(1);
        expect((nodes[0] as any).title).toBe('v2');
    });

    test('getNodes returns all nodes across types', () => {
        const store = new NodeStore();
        store.createNode(makeNode({ id: 'a', internal: { type: 'BlogPost', contentDigest: 'x' } }));
        store.createNode(makeNode({ id: 'b', internal: { type: 'File', contentDigest: 'y' } }));
        expect(store.getNodes()).toHaveLength(2);
    });

    test('getTypes returns distinct type names', () => {
        const store = new NodeStore();
        store.createNode(makeNode({ id: 'a', internal: { type: 'BlogPost', contentDigest: 'x' } }));
        store.createNode(makeNode({ id: 'b', internal: { type: 'BlogPost', contentDigest: 'y' } }));
        store.createNode(makeNode({ id: 'c', internal: { type: 'File', contentDigest: 'z' } }));
        expect(store.getTypes().sort()).toEqual(['BlogPost', 'File']);
    });

    test('getNode returns undefined for missing id', () => {
        const store = new NodeStore();
        expect(store.getNode('nonexistent')).toBeUndefined();
    });

    test('createNode throws on missing id', () => {
        const store = new NodeStore();
        expect(() => store.createNode({ id: '', internal: { type: 'T', contentDigest: 'x' } }))
            .toThrow('node.id');
    });

    test('createNode throws on missing type', () => {
        const store = new NodeStore();
        expect(() => store.createNode({ id: 'x', internal: { type: '', contentDigest: 'x' } }))
            .toThrow('node.internal.type');
    });
});
