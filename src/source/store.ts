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
    private byType = new Map<string, Map<string, HadarsNode>>();

    createNode(node: HadarsNode): void {
        if (!node.id) throw new Error('[hadars] createNode: node.id must be a non-empty string');
        if (!node.internal?.type) throw new Error('[hadars] createNode: node.internal.type must be a non-empty string');
        this.byId.set(node.id, node);
        let typeMap = this.byType.get(node.internal.type);
        if (!typeMap) { typeMap = new Map(); this.byType.set(node.internal.type, typeMap); }
        typeMap.set(node.id, node);
    }

    getNode(id: string): HadarsNode | undefined {
        return this.byId.get(id);
    }

    getNodes(): HadarsNode[] {
        return Array.from(this.byId.values());
    }

    getNodesByType(type: string): HadarsNode[] {
        const typeMap = this.byType.get(type);
        return typeMap ? Array.from(typeMap.values()) : [];
    }

    getTypes(): string[] {
        return Array.from(this.byType.keys());
    }
}
