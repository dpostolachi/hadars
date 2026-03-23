import { test, expect, describe } from 'bun:test';
import { createGraphiqlHandler, GRAPHQL_PATH } from '../src/source/graphiql';
import type { GraphQLExecutor } from '../src/types/hadars';

function makeExecutor(data: Record<string, unknown> = {}): GraphQLExecutor {
    return async () => ({ data });
}

function makeRequest(method: string, path: string, body?: unknown): Request {
    return new Request(`http://localhost${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe('createGraphiqlHandler', () => {
    test('returns undefined for non-graphql paths', async () => {
        const handler = createGraphiqlHandler(makeExecutor());
        expect(await handler(makeRequest('GET', '/other'))).toBeUndefined();
    });

    test('GET returns GraphiQL HTML page', async () => {
        const handler = createGraphiqlHandler(makeExecutor());
        const res = await handler(makeRequest('GET', GRAPHQL_PATH));
        expect(res?.status).toBe(200);
        expect(res?.headers.get('content-type')).toContain('text/html');
        const text = await res!.text();
        expect(text).toContain('GraphiQL');
        expect(text).toContain(GRAPHQL_PATH);
    });

    test('POST with valid query returns executor result as JSON', async () => {
        const handler = createGraphiqlHandler(makeExecutor({ hello: 'world' }));
        const res = await handler(makeRequest('POST', GRAPHQL_PATH, { query: '{ hello }' }));
        expect(res?.status).toBe(200);
        const json = await res!.json() as any;
        expect(json.data.hello).toBe('world');
    });

    test('POST with invalid JSON returns 400', async () => {
        const handler = createGraphiqlHandler(makeExecutor());
        const req = new Request(`http://localhost${GRAPHQL_PATH}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not json',
        });
        const res = await handler(req);
        expect(res?.status).toBe(400);
    });

    test('POST without query field returns 400', async () => {
        const handler = createGraphiqlHandler(makeExecutor());
        const res = await handler(makeRequest('POST', GRAPHQL_PATH, { variables: {} }));
        expect(res?.status).toBe(400);
        const json = await res!.json() as any;
        expect(json.errors[0].message).toContain('query');
    });

    test('POST with non-string query field returns 400', async () => {
        const handler = createGraphiqlHandler(makeExecutor());
        const res = await handler(makeRequest('POST', GRAPHQL_PATH, { query: 42 }));
        expect(res?.status).toBe(400);
    });

    test('POST with empty query string returns 400', async () => {
        const handler = createGraphiqlHandler(makeExecutor());
        const res = await handler(makeRequest('POST', GRAPHQL_PATH, { query: '   ' }));
        expect(res?.status).toBe(400);
    });

    test('POST executor error returns 500 with error message', async () => {
        const failingExecutor: GraphQLExecutor = async () => {
            throw new Error('executor crashed');
        };
        const handler = createGraphiqlHandler(failingExecutor);
        const res = await handler(makeRequest('POST', GRAPHQL_PATH, { query: '{ x }' }));
        expect(res?.status).toBe(500);
        const json = await res!.json() as any;
        expect(json.errors[0].message).toContain('executor crashed');
    });

    test('unsupported HTTP method returns 405', async () => {
        const handler = createGraphiqlHandler(makeExecutor());
        const res = await handler(makeRequest('DELETE', GRAPHQL_PATH));
        expect(res?.status).toBe(405);
    });

    test('forwards variables to executor', async () => {
        let capturedVars: any;
        const executor: GraphQLExecutor = async (_q, vars) => {
            capturedVars = vars;
            return { data: {} };
        };
        const handler = createGraphiqlHandler(executor);
        await handler(makeRequest('POST', GRAPHQL_PATH, {
            query: '{ x }',
            variables: { slug: 'hello' },
        }));
        expect(capturedVars).toEqual({ slug: 'hello' });
    });
});
