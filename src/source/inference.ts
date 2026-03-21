/**
 * Schema inference — builds a GraphQL schema from the node store automatically,
 * just like Gatsby does. Uses graphql-js (must be installed in the user's project).
 *
 * Dynamically imports graphql so hadars itself does not depend on it.
 */

import type { NodeStore } from './store';
import type { GraphQLExecutor } from '../types/hadars';

// ── Primitive inference ────────────────────────────────────────────────────────

type ScalarName = 'String' | 'Int' | 'Float' | 'Boolean' | 'ID';

function inferScalar(value: unknown): ScalarName {
    if (typeof value === 'boolean') return 'Boolean';
    if (typeof value === 'number') return Number.isInteger(value) ? 'Int' : 'Float';
    return 'String';
}

interface FieldShape {
    type: string;   // e.g. "String", "Int", "Boolean", "[String]", "InternalType"
    nullable: boolean;
}

function inferFieldShape(value: unknown, seenTypes: Set<string>): FieldShape {
    if (value === null || value === undefined) {
        return { type: 'String', nullable: true };
    }
    if (Array.isArray(value)) {
        const inner = value.length > 0
            ? inferFieldShape(value[0], seenTypes)
            : { type: 'String', nullable: true };
        return { type: `[${inner.type}]`, nullable: true };
    }
    if (typeof value === 'object') {
        // nested object — we don't recurse deeply for now; use JSON string
        return { type: 'String', nullable: true };
    }
    return { type: inferScalar(value), nullable: true };
}

// ── Schema string builder ──────────────────────────────────────────────────────

const INTERNAL_FIELDS = new Set(['id', 'internal', '__typename', 'parent', 'children']);

/** Scalar GraphQL types that are safe to use as lookup filter arguments. */
const FILTERABLE_SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);

interface InferredField {
    name: string;
    type: string;
    /** True when the base type is a plain scalar (not a list/object). */
    filterable: boolean;
}

function buildTypeFields(nodes: readonly Record<string, unknown>[]): InferredField[] {
    const fieldMap = new Map<string, InferredField>();

    for (const node of nodes) {
        for (const [key, val] of Object.entries(node)) {
            if (INTERNAL_FIELDS.has(key)) continue;
            if (fieldMap.has(key)) continue;
            const { type } = inferFieldShape(val, new Set());
            fieldMap.set(key, {
                name: key,
                type,
                filterable: FILTERABLE_SCALARS.has(type),
            });
        }
    }

    return Array.from(fieldMap.values());
}

function buildTypeSDL(typeName: string, fields: InferredField[]): string {
    const lines = [
        '  id: ID!',
        ...fields.map(f => `  ${f.name}: ${f.type}`),
    ];
    return `type ${typeName} {\n${lines.join('\n')}\n}`;
}

// ── Query builder ──────────────────────────────────────────────────────────────

/** Build allXxx / xxx query names from a type name, matching Gatsby's convention. */
function queryNames(typeName: string) {
    const lower = typeName.charAt(0).toLowerCase() + typeName.slice(1);
    return { single: lower, all: `all${typeName}` };
}

/**
 * Build the SDL argument list for the single-item query.
 * Includes `id` plus every filterable scalar field so callers can look up
 * nodes by any natural key (e.g. slug, email) without knowing the hashed id.
 * The resolver returns the first node where ALL supplied arguments match.
 */
function buildSingleArgs(fields: InferredField[]): string {
    const args = [
        'id: ID',
        ...fields.filter(f => f.filterable && f.name !== 'id').map(f => `${f.name}: ${f.type}`),
    ];
    return args.join(', ');
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Build a GraphQL executor backed by the node store.
 *
 * Returns null if graphql-js is not installed — in that case the caller should
 * surface a clear error message asking the user to install `graphql`.
 */
export async function buildSchemaExecutor(
    store: NodeStore,
): Promise<GraphQLExecutor | null> {
    // graphql is an optional peer dependency installed in the user's project,
    // not in hadars itself. Resolve it from process.cwd() so Node.js finds it
    // in the user's node_modules rather than the CLI's own node_modules.
    let gql: any;
    try {
        const { createRequire } = await import('node:module');
        const projectRequire = createRequire(process.cwd() + '/package.json');
        const graphqlPath = projectRequire.resolve('graphql');
        gql = await import(graphqlPath);
    } catch {
        return null;
    }

    const { buildSchema, graphql } = gql;

    const types = store.getTypes();
    if (types.length === 0) {
        // Empty store — return a no-op executor with a dummy schema
        const schema = buildSchema('type Query { _empty: String }');
        return (query, variables) => graphql({ schema, source: query, variableValues: variables });
    }

    // Infer field shapes once per type — reused for both the SDL and resolvers.
    const typeFields = new Map(
        types.map(typeName => {
            const nodes = store.getNodesByType(typeName) as Record<string, unknown>[];
            return [typeName, buildTypeFields(nodes)] as const;
        })
    );

    const typeSDLs = types.map(typeName =>
        buildTypeSDL(typeName, typeFields.get(typeName)!)
    );

    const queryFields = types.map(typeName => {
        const { single, all } = queryNames(typeName);
        const args = buildSingleArgs(typeFields.get(typeName)!);
        return [
            `  ${single}(${args}): ${typeName}`,
            `  ${all}: [${typeName}!]!`,
        ].join('\n');
    });

    const sdl = [
        ...typeSDLs,
        `type Query {\n${queryFields.join('\n')}\n}`,
    ].join('\n\n');

    let schema: any;
    try {
        schema = buildSchema(sdl);
    } catch (err) {
        throw new Error(`[hadars] Failed to build GraphQL schema from node store: ${(err as Error).message}`);
    }

    // Build root resolver map
    const rootValue: Record<string, unknown> = {};
    for (const typeName of types) {
        const { single, all } = queryNames(typeName);
        rootValue[all] = () => store.getNodesByType(typeName);
        // Single-item resolver: return the first node matching ALL supplied args.
        rootValue[single] = (args: Record<string, unknown>) => {
            const nodes = store.getNodesByType(typeName) as Record<string, unknown>[];
            return nodes.find(node =>
                Object.entries(args).every(([k, v]) => v === undefined || node[k] === v)
            ) ?? null;
        };
    }

    return (query, variables) =>
        graphql({ schema, rootValue, source: query, variableValues: variables }) as any;
}
