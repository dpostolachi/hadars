/**
 * GraphiQL dev endpoint — serves the GraphiQL IDE at GET /__hadars/graphql
 * and a JSON GraphQL API at POST /__hadars/graphql.
 *
 * Only mounted in dev mode when config.sources is present.
 */

import type { GraphQLExecutor } from '../types/hadars';

export const GRAPHQL_PATH = '/__hadars/graphql';

// GraphiQL HTML shell — UMD bundles from unpkg (dev-only).
// Using UMD avoids ES module peer-dependency conflicts (CodeMirror, etc.)
// and matches the official GraphiQL standalone embedding guide.
const GRAPHIQL_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GraphiQL — hadars</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { height: 100vh; overflow: hidden; }
    #graphiql { height: 100vh; }
  </style>
  <link rel="stylesheet" href="https://unpkg.com/graphiql@3/graphiql.min.css" />
</head>
<body>
  <div id="graphiql"></div>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/graphiql@3/graphiql.min.js" crossorigin></script>
  <script>
    const root = ReactDOM.createRoot(document.getElementById('graphiql'));
    root.render(
      React.createElement(GraphiQL, {
        fetcher: GraphiQL.createFetcher({ url: '${GRAPHQL_PATH}' }),
      })
    );
  </script>
</body>
</html>`;

/**
 * Returns a fetch handler that covers GET and POST for `/__hadars/graphql`.
 * Returns `undefined` for any other path so callers can chain normally.
 */
export function createGraphiqlHandler(
    executor: GraphQLExecutor,
): (req: Request) => Promise<Response | undefined> {
    return async (req: Request): Promise<Response | undefined> => {
        const url = new URL(req.url);
        if (url.pathname !== GRAPHQL_PATH) return undefined;

        // GET — serve GraphiQL IDE
        if (req.method === 'GET') {
            return new Response(GRAPHIQL_HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        // POST — execute GraphQL query
        if (req.method === 'POST') {
            let body: { query?: string; variables?: Record<string, unknown>; operationName?: string };
            try {
                body = await req.json();
            } catch {
                return new Response(JSON.stringify({ errors: [{ message: 'Invalid JSON body' }] }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            if (!body.query) {
                return new Response(JSON.stringify({ errors: [{ message: 'Missing "query" field' }] }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            try {
                const result = await executor(body.query, body.variables);
                return new Response(JSON.stringify(result), {
                    headers: { 'Content-Type': 'application/json' },
                });
            } catch (err) {
                return new Response(JSON.stringify({ errors: [{ message: (err as Error).message }] }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }

        return new Response('Method Not Allowed', { status: 405 });
    };
}
