import { wildcardMatch } from '../../../src/deploy/bunny/split';

type Resource = { Id: number; Name: string; EdgeScriptId?: number; [key: string]: any };
const collections = ['/pullzone', '/compute/script', '/storagezone'] as const;
type Collection = typeof collections[number];

/** Stateful mock exercises the real target's upload/readback, stage, publish, verify and flip. */
export function mockProvider(options: { listingPageSize?: number; split?: boolean; propagationSteps?: number; placeholderSeconds?: number | Record<string, number>; now?: () => number } = {}) {
    const pullDefaults = { EnableSmartCache: false, IgnoreQueryStrings: true, DisableCookies: true, AddHostHeader: false };
    let next = 1, tick = 0, operation = 0, failureAt = -1, failureAfter = false;
    const visibleZones = new Map<number, any>(), pending: { tick: number; row: any }[] = [];
    const handlers = new Map<number, (request: Request) => Response | Promise<Response>>();
    const advance = () => { tick++; for (const change of pending.filter(p => p.tick <= tick)) visibleZones.set(change.row.Id, change.row); for (let i = pending.length - 1; i >= 0; i--) if (pending[i].tick <= tick) pending.splice(i, 1); };
    const propagate = (row: any) => {
        if (!options.split) return;
        if (!visibleZones.has(row.Id)) visibleZones.set(row.Id, structuredClone(row));
        pending.push({ tick: tick + (options.propagationSteps ?? 0), row: structuredClone(row) });
    };
    const armFailure = (at: number, after = false) => { operation = 0; failureAt = at; failureAfter = after; };
    async function inject<T>(fn: () => Promise<T>): Promise<T> {
        const index = ++operation;
        if (index === failureAt && !failureAfter) { failureAt = -1; throw new Error(`Injected failure before ${index}`); }
        const result = await fn();
        if (index === failureAt && failureAfter) { failureAt = -1; throw new Error(`Injected lost reply after ${index}`); }
        return result;
    }

    const tables: Record<Collection, Resource[]> = { '/pullzone': [], '/compute/script': [], '/storagezone': [] };
    const changed = new Map<string, string>();
    const objects = new Map<string, Uint8Array>(), revisions = new Map<number, string>();
    const calls: string[] = [];
    const managementRequests: Array<{ method: string; path: string; body?: any }> = [];
    const storageRequests: Array<{ url: string; method: string }> = [];
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const publishedAt = new Map<number, number>();
    const now = options.now ?? Date.now;
    const published: Array<{ id: number; code: string; variables: any[] }> = [];
    const client: BunnyClient = {
        async request(method, path, body: any) {
            calls.push(`${method} ${path}`);
            managementRequests.push({ method, path, body: structuredClone(body) });
            const collection = collections.find(c => path === c || path.startsWith(c + '/'))!;
            if (!collection) throw new Error(`Unexpected mock request ${path}`);
            const rest = path.slice(collection.length + 1).split('/'), id = Number(rest[0]);
            if (method === 'GET' && path === collection) return structuredClone(tables[collection]);
            if (method === 'POST' && path === collection) {
                // Mirror the real API: a storage-backed pull zone is stored as OriginType 2 with an empty OriginUrl.
                const row = { ...(collection === '/pullzone' ? { ...pullDefaults, ...(options.split ? { EdgeRules: [], Hostnames: [{ Value: `${body.Name}.b-cdn.net` }] } : {}) } : {}), ...body, Id: next++, ...(collection === '/storagezone' ? { Password: 'mock' } : {}), ...(collection === '/pullzone' && body.StorageZoneId ? { OriginType: 2, OriginUrl: '' } : {}) };
                tables[collection].push(row);
                if (collection === '/pullzone') propagate(row);
                if (body.CreateLinkedPullZone) tables['/pullzone'].push({ ...pullDefaults, Id: next++, Name: body.Name, EdgeScriptId: row.Id });
                return { ...row };
            }
            const row = tables[collection].find(r => r.Id === id);
            if (collection === '/pullzone' && rest[1] === 'edgerules' && row) {
                row.EdgeRules ??= [];
                if (method === 'POST' && rest[2] === 'addOrUpdate') {
                    if (body.Triggers?.some((t: any) => t.PatternMatches?.length > 5)) throw new Error('Bunny request failed (400): {"ErrorKey":"edgerule.invalid","Message":"Maximum 5 triggers are allowed per condition."}');
                    // Mirror the real API (measured): a body WITH a Guid updates that rule and 404s when it does not exist;
                    // a body WITHOUT a Guid creates a rule and the provider assigns and returns the Guid.
                    if (Object.hasOwn(body, 'Guid')) {
                        const old = row.EdgeRules.find((r: any) => r.Guid === body.Guid);
                        if (!old) throw new Error('Bunny request failed (404)');
                        Object.assign(old, structuredClone(body));
                        propagate(row); return structuredClone(old);
                    }
                    if (row.EdgeRules.length >= 50) throw new Error('Bunny request failed (400): {"Message":"Maximum number of edge rules reached for this zone."}');
                    const created = { ...structuredClone(body), Guid: crypto.randomUUID(), OrderIndex: row.EdgeRules.length };
                    row.EdgeRules.push(created);
                    propagate(row); return structuredClone(created);
                }
                if (method === 'DELETE') { row.EdgeRules = row.EdgeRules.filter((r: any) => r.Guid !== rest[2]); propagate(row); return null; }
            }
            if (method === 'GET' && rest[1] === 'code' && row) return { Code: [...published].reverse().find(p => p.id === id)?.code ?? '' };
            if (method === 'GET' && rest[1] === 'secrets') return { Secrets: (row?.Secrets ?? []).map((s: any) => ({ Name: s.Name })) };
            if (method === 'PUT' && rest[1] === 'secrets' && row) { row.Secrets = (row.Secrets ?? []).filter((s: any) => s.Name !== body.Name).concat(structuredClone(body)); return null; }
            if (method === 'GET' && row) return structuredClone({ EdgeScriptVariables: [], ...row, DefaultHostname: `s${id}.bunny.run` });
            if (method === 'DELETE') {
                if (collection === '/compute/script' && options.split && tables['/pullzone'].some(z => (z.EdgeScriptId === id && z.Name !== row?.Name) || z.EdgeRules?.some((r: any) => r.ActionType === 21 && Number(r.ActionParameter1) === id))) throw new Error('Mock refuses deletion of a referenced script');
                tables[collection] = tables[collection].filter(r => r.Id !== id); return null; }
            if (method === 'PUT' && rest[1] === 'variables' && row) {
                row.EdgeScriptVariables ??= [];
                row.EdgeScriptVariables = row.EdgeScriptVariables.filter((v: any) => v.Name !== body.Name).concat(body);
                return null;
            }
            if (method === 'POST' && collection === '/pullzone' && row) { Object.assign(row, body); propagate(row); return row; }
            throw new Error(`Unexpected mock request ${method} ${path}`);
        },
        async publish(id, code) {
            calls.push(`publish ${id}`);
            publishedAt.set(Number(id), now());
            published.push({ id: Number(id), code, variables: structuredClone(tables['/compute/script'].find(r => r.Id === Number(id))?.EdgeScriptVariables ?? []) });
            if (options.split) {
                const unit = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
                if (typeof unit.default !== 'function') throw new Error('Split mock expects an actual Request-to-Response fixture');
                handlers.set(Number(id), unit.default);
            }
            revisions.set(Number(id), code.match(/headers.set\('x-hdt-revision', "([^"]+)"\)/)?.[1] ?? 'placeholder');
        },
    };
    const send = (async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname === 'storage.bunnycdn.com') {
            const objectPath = decodeURIComponent(url.pathname);
            storageRequests.push({ url: url.href, method: init?.method ?? 'GET' });
            if (init?.method === 'DELETE') { objects.delete(objectPath); return new Response(); }
            if (objectPath.endsWith('/')) {
                const entries = new Map<string, any>();
                for (const path of objects.keys()) if (path.startsWith(objectPath)) {
                    const relative = path.slice(objectPath.length), [ObjectName] = relative.split('/');
                    if (ObjectName) entries.set(ObjectName, { ObjectName, IsDirectory: relative.includes('/'), Length: objects.get(path)!.length, LastChanged: changed.get(path) ?? '2020-01-01T00:00:00Z' });
                }
                const rows = [...entries.values()];
                // Simulate an incomplete paginated envelope to exercise fail-closed collection.
                if (options.listingPageSize !== undefined) return Response.json({ Items: rows.slice(0, options.listingPageSize), TotalItems: rows.length, HasMore: rows.length > options.listingPageSize });
                return Response.json(rows);
            }
            if (init?.method === 'PUT') { objects.set(objectPath, new Uint8Array(await new Response(init.body).arrayBuffer())); changed.set(objectPath, new Date(Date.now() - 1000).toISOString()); return new Response(''); }
            const bytes = objects.get(objectPath); return new Response(bytes ? new Uint8Array(bytes).buffer : null, { status: bytes ? 200 : 404 });
        }
        requests.push({ url: url.href, method: init?.method ?? 'GET', body: init?.body as string | undefined });
        const assets = tables['/pullzone'].find(z => `${z.Name}.b-cdn.net` === url.hostname && z.StorageZoneId);
        if (assets) {
            const storage = tables['/storagezone'].find(z => z.Id === assets.StorageZoneId)!;
            const bytes = objects.get(`/${storage.Name}${decodeURIComponent(url.pathname)}`);
            return new Response(bytes ? new Uint8Array(bytes).buffer : null, { status: bytes ? 200 : 404, headers: { 'content-type': 'application/javascript' } });
        }
        if (options.split) advance();
        const managed = tables['/pullzone'].find(z => `${z.Name}.b-cdn.net` === url.hostname || options.split && z.Hostnames?.some((h: any) => h.Value === url.hostname));
        const zone = options.split && managed ? visibleZones.get(managed.Id) ?? managed : managed;
        const selectedRule = options.split && zone?.EdgeRules?.filter((r: any) => r.Enabled).sort((a: any, b: any) => a.OrderIndex - b.OrderIndex).find((r: any) => r.ActionType === 21 && r.Triggers.some((t: any) => t.Type === 0 && t.PatternMatches.some((p: string) => wildcardMatch(p, url.href))));
        const id = /^s[0-9]+\.bunny\.run$/.test(url.hostname) ? Number(url.hostname.slice(1).split('.')[0]) : selectedRule ? Number(selectedRule.ActionParameter1) : zone?.EdgeScriptId;
        const script = tables['/compute/script'].find(r => r.Id === id);
        if (!script) throw new Error('Mock egress refused');
        const seconds = typeof options.placeholderSeconds === 'number' ? options.placeholderSeconds : options.placeholderSeconds?.[script.Name] ?? 0;
        if (now() - (publishedAt.get(id!) ?? 0) < seconds * 1000) return new Response('Provider placeholder: script not ready', { headers: { 'content-type': 'text/html' } });
        if (options.split) { const handler = handlers.get(id!); if (!handler) throw new Error('Mock unpublished split script'); return handler(new Request(url, init)); }
        const variables = Object.fromEntries((script.EdgeScriptVariables ?? []).map((v: any) => [v.Name, v.DefaultValue]));
        const headers = { 'x-hdt-revision': revisions.get(id!) ?? '' };
        if (url.pathname === '/api/graphql' && init?.method === 'POST') {
            if (variables.HADARS_APP_BUNNY_BE_GRAPHQL_ENDPOINT !== 'https://app.example.com/api/graphql' || init.body !== JSON.stringify({ query: '{__typename}' })) throw new Error('Mock proxy config/query mismatch');
            return Response.json({ data: { __typename: 'RootQuery' } }, { headers });
        }
        if (url.pathname.startsWith('/_builds/')) return new Response(null, { status: 404, headers });
        return new Response(url.pathname === '/health' ? 'OK' : `<html><script>__HADARS_ASSET_BASE_URL__="${variables.HADARS_ASSET_BASE_URL}"</script><script src="${variables.HADARS_ASSET_BASE_URL}/${[...objects.keys()].map(p => p.split('/').slice(2).join('/')).find(p => hashedShellPath(p) && p.endsWith('.js')) ?? 'missing.js'}"></script><img src="https://static.introtrace.net/logo.svg"></html>`, { headers: { ...headers, 'content-type': url.pathname === '/health' ? 'text/plain' : 'text/html' } });
    }) as typeof fetch;
    const requestImpl = client.request.bind(client), publishImpl = client.publish.bind(client);
    client.request = (method, path, body) => inject(() => requestImpl(method, path, body));
    client.publish = (id, code) => inject(() => publishImpl(id, code));
    const injectedSend = ((input: any, init: any) => inject(() => send(input, init))) as typeof fetch;
    return { client, send: injectedSend, advance, armFailure, get operationCount() { return operation; }, tables, calls, managementRequests, requests, storageRequests, published, objects, changed };
}
