import { rspack } from '@rspack/core';
import ReactRefreshPlugin from '@rspack/plugin-react-refresh';
import http from 'node:http';
import path from 'node:path';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { MODULES_GLOBAL, type TargetManifest } from './constants';
import { moduleConfig, writeBarrel, type BuildModuleOptions } from './moduleBuild';

export interface ModuleDevServerOptions extends Omit<BuildModuleOptions, 'mode'> {
    /** Port for the module's dev server; 0 picks a free one. */
    port?: number;
}

export interface ModuleDevServer {
    /** Origin the shell loads the client bundle from (also the `publicPath`). */
    clientUrl: string;
    /** Directory for `loadServerModule`; rebuilt on every change. */
    serverDir: string;
    /** Number of completed client rebuilds. */
    readonly builds: number;
    close(): Promise<void>;
}

// First entry of the dev client: applies hot updates when the dev server reports a rebuild.
// An update no component boundary accepts (e.g. a file that also exports a context) cannot be
// applied in place, so the page reloads, as webpack-dev-server does.
const HMR_CLIENT = `if (import.meta.webpackHot) {
    const es = new EventSource(__webpack_public_path__ + '__hmr');
    es.onmessage = () => {
        import.meta.webpackHot.check(true).catch((e) => {
            globalThis.__hadarsModuleHmrError = String((e && e.message) || e);
            location.reload();
        });
    };
}
`;

const MIME: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

/**
 * Runs a module the way a developer works on it locally: rebuilds on every
 * change, hot-updates the client bundle (including React Fast Refresh) and
 * keeps the server bundle current. The shell (a dev build, which publishes the
 * refresh runtime) loads the client bundle from `clientUrl` and the server bundle
 * from `serverDir`.
 */
export async function startModuleDevServer(opts: ModuleDevServerOptions): Promise<ModuleDevServer> {
    const { composition, outDir } = opts;
    const { name } = composition;
    const clientDir = path.join(outDir, 'client');
    const serverDir = path.join(outDir, 'server');
    mkdirSync(clientDir, { recursive: true });
    const sseClients = new Set<http.ServerResponse>();

    const server = http.createServer((req, res) => {
        const cors = { 'access-control-allow-origin': '*' };
        const pathname = new URL(req.url ?? '/', 'http://x').pathname;
        if (pathname === '/__hmr') {
            res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
            res.write(': ok\n\n');
            sseClients.add(res);
            req.on('close', () => sseClients.delete(res));
            return;
        }
        const file = path.join(clientDir, pathname);
        let isFile = false;
        try { isFile = !pathname.includes('..') && statSync(file).isFile(); } catch {}
        if (!isFile) {
            res.writeHead(404, cors).end('not found');
            return;
        }
        res.writeHead(200, { ...cors, 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(readFileSync(file));
    });
    await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
    const clientUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

    const barrel = writeBarrel({ ...opts, mode: 'development' });
    const hmrClient = path.join(outDir, `${name}.hmr-client.js`);
    writeFileSync(hmrClient, HMR_CLIENT);

    const clientCompiler = rspack({
        ...moduleConfig({ ...opts, mode: 'development', target: 'web', refresh: true }),
        entry: { [name]: [hmrClient, barrel] },
        output: {
            path: clientDir,
            publicPath: clientUrl,
            filename: '[name].js',
            uniqueName: `hadars-module-${name}`,
            library: { type: 'assign-properties', name: [MODULES_GLOBAL, name] },
        },
        plugins: [
            new rspack.HotModuleReplacementPlugin(),
            // The refresh runtime comes from the shell; injecting an entry here would load a second copy.
            new ReactRefreshPlugin({ injectEntry: false, overlay: false }),
        ],
    } as any);
    const serverCompiler = rspack({
        ...moduleConfig({ ...opts, mode: 'development', target: 'node' }),
        entry: { [name]: barrel },
        output: { path: serverDir, filename: '[name].cjs', library: { type: 'commonjs2' } },
    } as any);

    const writeManifest = (dir: string, stats: any) => {
        const assets = (stats.toJson({ all: false, entrypoints: true }).entrypoints?.[name]?.assets ?? [])
            .map((a: { name: string }) => a.name as string)
            // Hot-update chunks are transient and only the HMR runtime may load them.
            .filter((a: string) => !a.includes('.hot-update.'));
        const manifest: TargetManifest = {
            js: assets.filter((a: string) => /\.c?js$/.test(a)),
            css: assets.filter((a: string) => a.endsWith('.css')),
        };
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    };

    const watchers: Array<{ close(): Promise<void> }> = [];
    const watch = (compiler: NonNullable<ReturnType<typeof rspack>>, dir: string, after?: (stats: any) => void) =>
        new Promise<void>((resolve, reject) => {
            let first = true;
            const watching = compiler.watch({}, (err, stats) => {
                const error = err ?? (stats?.hasErrors() ? new Error(`[hadars] Initial module compilation failed:\n${stats.toString({ errors: true })}`) : undefined);
                if (error) {
                    if (first) { first = false; reject(error); }
                    else console.error('[hadars] module build error', error);
                    return;
                }
                if (stats) { writeManifest(dir, stats); after?.(stats); }
                if (first) { first = false; resolve(); }
            });
            watchers.push({ close: () => new Promise<void>((r) => watching.close(() => r())) });
        });

    let builds = 0;
    const results = await Promise.allSettled([
        watch(clientCompiler, clientDir, (stats) => {
            builds++;
            for (const c of sseClients) c.write(`data: ${stats.hash}\n\n`);
        }),
        watch(serverCompiler, serverDir),
    ]);
    const failure = results.find((r) => r.status === 'rejected');
    if (failure?.status === 'rejected') {
        await Promise.all(watchers.map((w) => w.close()));
        await new Promise<void>((r) => server.close(() => r()));
        throw failure.reason;
    }

    return {
        clientUrl,
        serverDir,
        get builds() { return builds; },
        async close() {
            for (const c of sseClients) c.end();
            await Promise.all(watchers.map((w) => w.close()));
            await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections?.(); });
        },
    };
}
