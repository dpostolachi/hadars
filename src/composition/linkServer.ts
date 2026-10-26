import { build } from 'esbuild';
import path from 'node:path';

import { CompositionLinkError } from './errors';

/** Compile only verified snapshot bytes. No resolution can escape the pinned artifact. */
export async function linkServer(name: string, entry: string, files: Map<string, Buffer>): Promise<{ factory: string; files: string[] }> {
    const used = new Set<string>();
    try {
        const result = await build({
            entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'browser',
            target: 'es2022', minify: true, legalComments: 'none', logLevel: 'silent',
            plugins: [{ name: 'verified-module', setup(builder) {
                builder.onResolve({ filter: /.*/ }, (args) => {
                    const file = args.kind === 'entry-point' ? args.path : path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
                    if (args.kind !== 'entry-point' && !args.path.startsWith('.')) throw new Error(`unresolved external ${args.path}; declare shared packages when building the module`);
                    const resolved = [file, file + '.js', file + '.cjs'].find((p) => files.has(p));
                    if (!resolved) throw new Error(`missing verified dependency ${file}`);
                    return { path: resolved, namespace: 'verified' };
                });
                builder.onLoad({ filter: /.*/, namespace: 'verified' }, (args) => {
                    used.add(args.path);
                    return { contents: files.get(args.path)!, loader: args.path.endsWith('.json') ? 'json' : 'js' };
                });
            } }],
        });
        const code = result.outputFiles[0]!.text;
        if (/\brequire\b|\bimport\s*\(/.test(code) || result.warnings.length) throw new Error('dynamic loading is unsupported in a single script');
        return { files: [...used], factory: `() => { const module = { exports: {} }; const exports = module.exports; ${code}\nreturn module.exports; }` };
    } catch (error: any) {
        throw new CompositionLinkError(name, error.message);
    }
}
