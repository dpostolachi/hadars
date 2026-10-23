import type { HadarsOptions } from 'hadars';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// MODULE_DIR is the output directory of buildModule() for the greeter module.
const moduleDir = process.env.MODULE_DIR ?? '';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    composition: { role: 'shell', name: 'shell' },
    port: Number(process.env.PORT ?? 4180),
    // Serves the module's client files; a real setup would point at a CDN.
    fetch: async (req) => {
        const { pathname } = new URL(req.url);
        const file = pathname.match(/^\/w\/greeter\/(.+)$/)?.[1];
        if (!file || file.includes('..')) return undefined;
        try {
            const body = await readFile(path.join(moduleDir, 'client', file));
            const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/javascript';
            return new Response(new Uint8Array(body), { headers: { 'content-type': type } });
        } catch {
            return new Response('not found', { status: 404 });
        }
    },
};

export default config;
