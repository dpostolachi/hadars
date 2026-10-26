// Kept in the built template so runtime config need not retain build options.
export const ASSET_BASE_MARKER = /<meta name="HADARS_ASSET_BASE" content="([^"]*)"\s*\/?>/;

export function builtAssetMetadata(html: string): { base: string; files: string[] } | undefined {
    const marker = html.match(ASSET_BASE_MARKER);
    return marker ? JSON.parse(decodeURIComponent(marker[1]!)) : undefined;
}

export function runtimeAssetBase(env?: Record<string, unknown>): unknown {
    if (env) return env.HADARS_ASSET_BASE_URL;
    const runtime = globalThis as any;
    try {
        return runtime.Deno?.env?.get('HADARS_ASSET_BASE_URL')
            ?? runtime.process?.env?.HADARS_ASSET_BASE_URL;
    } catch {
        return runtime.process?.env?.HADARS_ASSET_BASE_URL;
    }
}

export function validateAssetBase(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string' && value && !/[\s\\?#<>"'\u0000-\u001f\u007f]/.test(value)) {
        if (value.startsWith('/') && !value.startsWith('//')) return value.replace(/\/+$/, '');
        try {
            const url = new URL(value);
            if (/^https?:\/\//i.test(value) && url.hostname && !url.username && !url.password) {
                return value.replace(/\/+$/, '');
            }
        } catch { /* Fall back to the built base. */ }
    }
    console.warn('Invalid HADARS_ASSET_BASE_URL; using the built asset base.');
    return undefined;
}

/** Relative pinned assets share the deployment base; separate origins stay independent. */
export function relocateAssetUrl(url: string, builtBase: string, base: string): string {
    const prefix = builtBase.replace(/\/+$/, '');
    if (prefix && url.startsWith(prefix + '/')) return base + url.slice(prefix.length);
    if (url.startsWith('/') && !url.startsWith('//')) return base + url;
    return url;
}

export function relocatePinnedBuilds<T extends Record<string, { client: { baseUrl: string } }>>(
    builds: T | undefined, builtBase: string, base: string | undefined,
): T | undefined {
    if (!builds || base === undefined) return builds;
    return Object.fromEntries(Object.entries(builds).map(([name, build]) => [name, {
        ...build, client: { ...build.client, baseUrl: relocateAssetUrl(build.client.baseUrl, builtBase, base) },
    }])) as T;
}

export function deploymentPinnedClients<T extends Record<string, { baseUrl: string }>>(
    clients: T | undefined, html: string, value: unknown,
): T | undefined {
    if (!clients) return clients;
    const base = validateAssetBase(value);
    if (base === undefined) return clients;
    const builtBase = builtAssetMetadata(html)?.base ?? '';
    return Object.fromEntries(Object.entries(clients).map(([name, client]) => [name, {
        ...client, baseUrl: relocateAssetUrl(client.baseUrl, builtBase, base),
    }])) as T;
}
