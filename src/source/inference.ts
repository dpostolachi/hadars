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
/** GraphQL spec reserves all names beginning with __ for introspection. */
const isReservedFieldName = (name: string) => name.startsWith('__');

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
            if (INTERNAL_FIELDS.has(key) || isReservedFieldName(key)) continue;
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
 * Load graphql-js from the user's project and build a schema + SDL from the
 * node store. Returns null if graphql-js is not installed.
 */
async function loadAndBuildSchema(store: NodeStore): Promise<{
    schema: any;
    sdl: string;
    gql: any;
} | null> {
    let gql: any;
    try {
        const { createRequire } = await import('node:module');
        const projectRequire = createRequire(process.cwd() + '/package.json');
        const graphqlPath = projectRequire.resolve('graphql');
        gql = await import(graphqlPath);
    } catch {
        return null;
    }

    const { buildSchema, printSchema, print } = gql;
    const types = store.getTypes();

    if (types.length === 0) {
        const rawSdl = 'type Query { _empty: String }';
        return { schema: buildSchema(rawSdl), sdl: rawSdl, gql };
    }

    // Infer field shapes once per type — reused for SDL, resolvers, and args.
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

    const rawSdl = [
        ...typeSDLs,
        `type Query {\n${queryFields.join('\n')}\n}`,
    ].join('\n\n');

    let schema: any;
    try {
        schema = buildSchema(rawSdl);
    } catch (err) {
        throw new Error(`[hadars] Failed to build GraphQL schema from node store: ${(err as Error).message}`);
    }

    return { schema, sdl: printSchema(schema), gql };
}

/**
 * Build a GraphQL executor backed by the node store.
 *
 * Returns null if graphql-js is not installed — in that case the caller should
 * surface a clear error message asking the user to install `graphql`.
 */
/**
 * Normalise a query argument to a string.
 * Accepts either a plain query string or a TypedDocumentNode / codegen document object.
 */
function toQueryString(query: unknown, print: (doc: any) => string): string {
    return typeof query === 'string' ? query : print(query);
}

export async function buildSchemaExecutor(
    store: NodeStore,
): Promise<GraphQLExecutor | null> {
    const built = await loadAndBuildSchema(store);
    if (!built) return null;

    const { schema, gql } = built;
    const { graphql, print } = gql;
    const types = store.getTypes();

    if (types.length === 0) {
        return (query, variables) =>
            graphql({ schema, source: toQueryString(query, print), variableValues: variables });
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
        graphql({ schema, rootValue, source: toQueryString(query, print), variableValues: variables }) as any;
}

/**
 * Return the inferred GraphQL schema as a SDL string suitable for writing to a
 * `schema.graphql` file and consuming with graphql-codegen or gql.tada.
 *
 * Returns null if graphql-js is not installed in the user's project.
 */
export async function buildSchemaSDL(store: NodeStore): Promise<string | null> {
    const built = await loadAndBuildSchema(store);
    return built?.sdl ?? null;
}

/**
 * Introspect a custom GraphQL executor and return its schema as SDL.
 * Uses the standard introspection query so the executor doesn't need to know
 * about hadars internals.
 *
 * Returns null if graphql-js is not installed in the user's project.
 */
export async function introspectExecutorSDL(
    executor: GraphQLExecutor,
): Promise<string | null> {
    let gql: any;
    try {
        const { createRequire } = await import('node:module');
        const projectRequire = createRequire(process.cwd() + '/package.json');
        const graphqlPath = projectRequire.resolve('graphql');
        gql = await import(graphqlPath);
    } catch {
        return null;
    }

    const { getIntrospectionQuery, buildClientSchema, printSchema } = gql;
    const result = await executor(getIntrospectionQuery());
    if (result.errors?.length) {
        throw new Error(`[hadars] Introspection failed: ${result.errors[0].message}`);
    }
    if (!result.data) {
        throw new Error('[hadars] Introspection returned no data');
    }
    return printSchema(buildClientSchema(result.data));
}
