/**
 * In-memory node store — the equivalent of Gatsby's internal node database.
 * Source plugins write nodes here via the context shim; the schema inferencer
 * reads them to build the GraphQL schema.
 */

export interface HadarsNode {
    id: string;
    /** Gatsby convention: the node type string, e.g. "MarkdownRemark", "ContentfulBlogPost". */
    internal: {
        type: string;
        contentDigest: string;
        content?: string;
        mediaType?: string;
        description?: string;
    };
    [key: string]: unknown;
}

export class NodeStore {
    private byId   = new Map<string, HadarsNode>();
    private byType = new Map<string, HadarsNode[]>();

    createNode(node: HadarsNode): void {
        this.byId.set(node.id, node);
        const list = this.byType.get(node.internal.type) ?? [];
        // Replace existing node with same id if present
        const idx = list.findIndex(n => n.id === node.id);
        if (idx >= 0) list[idx] = node; else list.push(node);
        this.byType.set(node.internal.type, list);
    }

    getNode(id: string): HadarsNode | undefined {
        return this.byId.get(id);
    }

    getNodes(): HadarsNode[] {
        return Array.from(this.byId.values());
    }

    getNodesByType(type: string): HadarsNode[] {
        return this.byType.get(type) ?? [];
    }

    getTypes(): string[] {
        return Array.from(this.byType.keys());
    }
}
