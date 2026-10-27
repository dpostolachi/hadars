import { build } from 'esbuild';
import { parseSync } from '@swc/core';
import path from 'node:path';

import { CompositionLinkError } from './errors';

/** Inspect emitted JavaScript, including expressions inside template interpolations. */
export function hasUnsupportedServerLoading(code: string): boolean {
    const ast = parseSync(code, { syntax: 'ecmascript', target: 'es2022' });
    const bindings = new Set<number>();
    const references: number[] = [];
    const bind = (pattern: any): void => {
        if (!pattern) return;
        switch (pattern.type) {
            case 'Identifier':
                if (pattern.value === 'require') bindings.add(pattern.ctxt);
                break;
            case 'ArrayPattern': pattern.elements.forEach(bind); break;
            case 'ObjectPattern': pattern.properties.forEach(bind); break;
            case 'KeyValuePatternProperty': bind(pattern.value); break;
            case 'AssignmentPatternProperty': bind(pattern.key); break;
            case 'AssignmentPattern': bind(pattern.left); break;
            case 'RestElement': bind(pattern.argument); break;
        }
    };
    // The parser resolves lexical contexts, so hoisted and shadowed bindings can
    // be matched without rescanning scopes. Property names have no context.
    // Use an explicit stack to avoid recursion through deeply nested expressions.
    const pending: any[] = [ast];
    while (pending.length) {
        const node = pending.pop();
        if (!node || typeof node !== 'object') continue;
        if (node.type === 'Import' || (node.type === 'MetaProperty' && node.kind === 'import.meta')) return true;
        if (node.type === 'MemberExpression' || node.type === 'SuperPropExpression') {
            const property = node.property;
            if ((property.type === 'Identifier' && property.value === 'require') ||
                (property.type === 'Computed' && property.expression.type === 'StringLiteral' && property.expression.value === 'require')) return true;
        }
        switch (node.type) {
            case 'VariableDeclarator': bind(node.id); break;
            case 'Parameter': bind(node.pat); break;
            case 'ArrowFunctionExpression': node.params.forEach(bind); break;
            case 'CatchClause': bind(node.param); break;
            case 'SetterProperty': bind(node.param); break;
            case 'FunctionDeclaration': case 'FunctionExpression':
            case 'ClassDeclaration': case 'ClassExpression': bind(node.identifier); break;
        }
        if (node.type === 'Identifier' && node.value === 'require' && node.ctxt !== undefined) references.push(node.ctxt);
        for (const key in node) {
            if (key === 'span' || key === 'label') continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) if (item && typeof item === 'object') pending.push(item);
            } else if (child && typeof child === 'object') pending.push(child);
        }
    }
    return references.some((context) => !bindings.has(context));
}

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
        if (result.warnings.length || hasUnsupportedServerLoading(code)) throw new Error('dynamic loading is unsupported in a single script');
        return { files: [...used], factory: `() => { const module = { exports: {} }; const exports = module.exports; ${code}\nreturn module.exports; }` };
    } catch (error: any) {
        throw new CompositionLinkError(name, error.message);
    }
}
