import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'esbuild';

// Only these options are consumed by bundled request handlers. In particular,
// never carry compiler configuration (or its initializers) across this boundary.
const runtimeKeys = new Set(['fetch', 'proxy', 'proxyCORS', 'cache', 'onError', 'onResponse']);

/** Project a declarative config onto its runtime bindings, before bundling. */
export async function runtimeConfigSource(source: string, filename: string): Promise<string> {
    const { transformSync, parseSync, printSync } = await import('@swc/core');
    // Erase types first so type references cannot retain compilation dependencies.
    const js = transformSync(source, {
        filename,
        jsc: { parser: { syntax: 'typescript', tsx: /\.[jt]sx$/.test(filename) }, target: 'es2022' },
        module: { type: 'es6' },
    }).code;
    const ast: any = parseSync(js, { syntax: 'ecmascript' });
    const bindings = new Map<string, any>();
    const declarations: any[] = [];
    const imports: any[] = [];
    let root: any;
    let imperative = false;
    let explicit: any;
    const key = (id: any) => `${id.value}:${id.ctxt}`;
    function walk(node: any, visit: (node: any) => void) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(n => walk(n, visit)); return; }
        visit(node);
        for (const [name, value] of Object.entries(node)) {
            if (name !== 'span') walk(value, visit);
        }
    }
    function patternBindings(pattern: any): any[] {
        if (!pattern) return [];
        if (pattern.type === 'Identifier') return [pattern];
        if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(patternBindings);
        if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap((p: any) =>
            patternBindings(p.type === 'AssignmentPatternProperty' ? p.key : p.value ?? p.argument));
        if (pattern.type === 'AssignmentPattern') return patternBindings(pattern.left);
        if (pattern.type === 'RestElement') return patternBindings(pattern.argument);
        return [];
    }
    function indexBindings(statement: any) {
        if (statement.type === 'VariableDeclaration') {
            for (const d of statement.declarations) {
                for (const id of patternBindings(d.id)) bindings.set(key(id), statement);
            }
        } else if (statement.identifier) bindings.set(key(statement.identifier), statement);
    }
    function bind(statement: any) {
        declarations.push(statement);
        indexBindings(statement);
    }
    for (const statement of ast.body) {
        if (statement.type === 'ImportDeclaration') {
            imports.push(statement);
            if (!statement.specifiers.length) imperative = true;
        }
        else if (statement.type === 'ExportDefaultExpression') root = statement;
        else if (statement.type === 'ExportDeclaration') {
            bind(statement.declaration);
            if (statement.declaration.type === 'VariableDeclaration') {
                explicit = statement.declaration.declarations.find((d: any) => d.id.value === 'runtimeConfig')?.id ?? explicit;
            }
        }
        else if (['VariableDeclaration', 'FunctionDeclaration', 'ClassDeclaration'].includes(statement.type)) bind(statement);
        else if (statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression'
            && statement.expression.operator === '=' && statement.expression.left.type === 'MemberExpression'
            && statement.expression.left.object.value === 'module' && statement.expression.left.property.value === 'exports') {
            root = { type: 'ExportDefaultExpression', span: statement.span, expression: statement.expression.right };
        } else if (statement.type !== 'EmptyStatement' && !(statement.type === 'ExpressionStatement' && statement.expression.type === 'StringLiteral')) imperative = true;
    }
    const fail = () => new Error(`Cannot isolate runtime config in ${filename}: export a declarative object (local object spreads are supported), or a named runtimeConfig object for dynamic build configuration.`);
    // An explicit runtime object also supports configs assembled imperatively by
    // build tooling. Its dependencies are still sliced, never the default config.
    if (explicit) root = { type: 'ExportDefaultExpression', span: explicit.span, expression: { ...explicit } };
    if (!root || (imperative && !explicit)) throw fail();
    const projected = new Set<any>();
    function project(node: any): void {
        if (!node || projected.has(node)) return;
        projected.add(node);
        if (node.type === 'Identifier') {
            const statement = bindings.get(key(node));
            const d = statement?.type === 'VariableDeclaration' && statement.declarations.find((d: any) => d.id.type === 'Identifier' && key(d.id) === key(node));
            if (!d?.init) throw fail();
            project(d.init);
        } else if (node.type === 'ObjectExpression') {
            node.properties = node.properties.filter((p: any) => {
                if (p.type === 'SpreadElement') { project(p.arguments); return true; }
                const name = p.type === 'Identifier' ? p.value : p.key?.value;
                if (typeof name !== 'string') throw fail();
                return runtimeKeys.has(name);
            });
        } else if (node.type === 'ConditionalExpression') {
            project(node.consequent); project(node.alternate);
        } else if (node.type === 'ParenthesisExpression') project(node.expression);
        else throw fail();
    }
    project(root.expression);
    // Split declarations: an unrelated eager plugin factory must not survive
    // merely because it shares a `const` statement with a runtime value.
    const split: any[] = [];
    bindings.clear();
    for (const statement of declarations) {
        for (const s of statement.type === 'VariableDeclaration'
            ? statement.declarations.map((d: any) => ({ ...statement, declarations: [d] })) : [statement]) {
            split.push(s);
            indexBindings(s);
        }
    }
    const needed = new Set<any>();
    const used = new Set<string>();
    function depend(node: any) {
        walk(node, id => {
            if (id.type !== 'Identifier' || id.ctxt === undefined) return;
            const name = key(id);
            if (used.has(name)) return;
            used.add(name);
            const declaration = bindings.get(name);
            if (declaration) { needed.add(declaration); depend(declaration); }
        });
    }
    depend(root);
    ast.body = [
        ...imports.map(s => ({ ...s, specifiers: s.specifiers.filter((s: any) => used.has(key(s.local))) })).filter(s => s.specifiers.length),
        ...split.filter(s => needed.has(s)),
        root,
    ];
    return printSync(ast).code;
}

/** Load only the app config through the projection; runtime imports stay real. */
export function runtimeConfigPlugin(configPath: string): Plugin {
    return {
        name: 'runtime-config',
        setup(build) {
            build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async ({ path }) => {
                if (resolve(path) !== resolve(configPath)) return;
                return { contents: await runtimeConfigSource(await readFile(path, 'utf8'), path), loader: 'js' };
            });
        },
    };
}
