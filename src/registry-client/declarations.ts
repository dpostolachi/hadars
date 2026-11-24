import ts from 'typescript';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { declarationsHashFor, type TypeApi } from '../registry-protocol';
import { ApiError } from './client';
import { bytesHash } from './lockfile';
import type { ModuleConfig } from './manifest';

const inside = (root: string, p: string) => p === root || p.startsWith(root + path.sep);
const slash = (p: string) => p.split(path.sep).join('/');
const format = (d: readonly ts.Diagnostic[]) => ts.formatDiagnosticsWithColorAndContext(d, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: (f) => f, getNewLine: () => '\n' });
/** A build step in the private CLI: no changes to the framework or a producer's source files. */
export async function emitDeclarations(project: string, outDir: string, composition: ModuleConfig): Promise<TypeApi> {
    outDir = path.resolve(outDir);
    await mkdir(outDir, { recursive: true });
    const guard = path.join(outDir, '.types-lock');
    try { await mkdir(guard); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new ApiError('busy', 'Declaration emission is already running; remove .types-lock only after the old process exited.'); throw e; }
    try { return await emitDeclarationsUnlocked(project, outDir, composition); }
    finally { await rm(guard, { recursive: true, force: true }); }
}
async function emitDeclarationsUnlocked(project: string, outDir: string, composition: ModuleConfig): Promise<TypeApi> {
    project = path.resolve(project); outDir = path.resolve(outDir);
    const entries = Object.entries(composition.exposes);
    if (!entries.length || entries.some(([ns, p]) => !/^[A-Za-z_$][\w$]*$/.test(ns) || typeof p !== 'string' || !inside(project, path.resolve(project, p)))) throw new ApiError('types', 'Exposes must name source files within the project.');
    const configPath = ts.findConfigFile(project, ts.sys.fileExists);
    let parsed: ts.ParsedCommandLine | undefined;
    if (configPath) {
        const config = ts.readConfigFile(configPath, ts.sys.readFile);
        if (config.error) throw new ApiError('types', format([config.error]));
        parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
        if (parsed.errors.length) throw new ApiError('types', format(parsed.errors));
    }
    await mkdir(outDir, { recursive: true });
    const staging = await mkdtemp(path.join(outDir, '.types-'));
    const files = new Map<string, string>();
    try {
        const options: ts.CompilerOptions = {
            strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
            jsx: ts.JsxEmit.ReactJSX, ...parsed?.options,
            declaration: true, emitDeclarationOnly: true, noEmit: false, noEmitOnError: true, declarationMap: false,
            rootDir: project, outDir: path.join(staging, '_sources'), declarationDir: path.join(staging, '_sources'),
            composite: false, incremental: false, tsBuildInfoFile: undefined, outFile: undefined,
        };
        const roots = [...entries.map(([, file]) => path.resolve(project, file)), ...(parsed?.fileNames.filter((f) => f.endsWith('.d.ts') && !inside(outDir, f)) ?? [])];
        const program = ts.createProgram(roots, options);
        const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
        if (diagnostics.length) throw new ApiError('types', format(diagnostics));
        const printer = ts.createPrinter({ removeComments: true });
        const rewrite = (text: string, original: string) => {
            const source = ts.createSourceFile(original, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
            const transform = ts.transform(source, [(context) => {
                const specifier = (s: ts.StringLiteralLike) => {
                    const resolved = ts.resolveModuleName(s.text, original, options, ts.sys).resolvedModule;
                    if (!resolved) return s;
                    if (!inside(project, resolved.resolvedFileName) || resolved.isExternalLibraryImport) {
                        if (s.text.startsWith('.')) throw new ApiError('types', `Declaration dependency outside project: ${s.text}`);
                        return s;
                    }
                    let rel = slash(path.relative(path.dirname(original), resolved.resolvedFileName)).replace(/(\.d)?\.[cm]?[jt]sx?$/, '');
                    if (!rel.startsWith('.')) rel = './' + rel;
                    return ts.factory.createStringLiteral(rel);
                };
                const visit: ts.Visitor = (node) => {
                    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause, specifier(node.moduleSpecifier), node.attributes);
                    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return ts.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, specifier(node.moduleSpecifier), node.attributes);
                    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) return ts.factory.updateImportTypeNode(node, ts.factory.createLiteralTypeNode(specifier(node.argument.literal)), node.attributes, node.qualifier, node.typeArguments, node.isTypeOf);
                    return ts.visitEachChild(node, visit, context);
                };
                return (sf) => ts.visitNode(sf, visit) as ts.SourceFile;
            }]);
            try { return printer.printFile(transform.transformed[0]); } finally { transform.dispose(); }
        };
        const emitted = program.emit(undefined, (file, text, _bom, _err, sources) => {
            if (!file.endsWith('.d.ts') || !inside(staging, file)) throw new ApiError('types', 'Only .ts/.tsx/.js declaration outputs are supported.');
            files.set(slash(path.relative(staging, file)), rewrite(text, sources?.[0]?.fileName ?? file));
        });
        if (emitted.emitSkipped || emitted.diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error)) throw new ApiError('types', format(emitted.diagnostics));
        // tsc references existing local declaration inputs but does not copy them into declarationDir.
        for (const sf of program.getSourceFiles()) if (sf.isDeclarationFile && inside(project, sf.fileName) && !sf.fileName.includes(`${path.sep}node_modules${path.sep}`) && !inside(outDir, sf.fileName)) {
            files.set('_sources/' + slash(path.relative(project, sf.fileName)), rewrite(sf.text, sf.fileName));
        }
        const checker = program.getTypeChecker();
        const exports: TypeApi['exports'] = {};
        for (const [ns, entry] of entries) {
            const sf = program.getSourceFile(path.resolve(project, entry));
            const module = sf && checker.getSymbolAtLocation(sf);
            if (!sf || !module) throw new ApiError('types', `${entry} must be an exported module`);
            if (sf.statements.some((s) => ts.isExportAssignment(s) && s.isExportEquals)) throw new ApiError('types', `${entry}: use ES module exports for an exposed namespace`);
            const symbols = checker.getExportsOfModule(module);
            const rel = './_sources/' + slash(path.relative(project, path.resolve(project, entry))).replace(/\.[jt]sx?$/, '');
            files.set(`${ns}.d.ts`, `export * from ${JSON.stringify(rel)};\n${symbols.some((s) => s.name === 'default') ? `export { default } from ${JSON.stringify(rel)};\n` : ''}`);
            exports[ns] = Object.fromEntries(symbols.map((symbol) => {
                const s = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
                const type = s.flags & ts.SymbolFlags.TypeAlias || s.flags & ts.SymbolFlags.Interface ? checker.getDeclaredTypeOfSymbol(s) : checker.getTypeOfSymbolAtLocation(s, s.valueDeclaration ?? sf);
                const structural = signature(type, checker, sf, new Set(), 0).replaceAll(project, '<project>').replaceAll(slash(project), '<project>');
                const display = checker.typeToString(type, sf, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias).replaceAll(project, '<project>').slice(0, 1024);
                return [symbol.name, JSON.stringify({ display, sha256: bytesHash(Buffer.from(structural)) })];
            }));
        }
        for (const [file, text] of files) { const dest = path.join(staging, file); await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, text); }
        const hashes = [...files].map(([file, text]) => ({ path: `types/${file}`, size: Buffer.byteLength(text), sha256: bytesHash(Buffer.from(text)) }));
        const api = { declarationsSha256: declarationsHashFor(hashes, hashes.map((f) => f.path)), exports };
        await writeFile(path.join(staging, 'api.json'), JSON.stringify(api, null, 2));
        const dest = path.join(outDir, 'types'), backup = path.join(outDir, '.types-previous');
        // No stale declaration files survive a successful build; a failed emit leaves old types intact.
        let hadOld = false;
        try { await rename(dest, backup); hadOld = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        try { await rename(staging, dest); }
        catch (e) { if (hadOld) await rename(backup, dest); throw e; }
        if (hadOld) await rm(backup, { recursive: true, force: true });
        return api;
    } finally { await rm(staging, { recursive: true, force: true }); }
}
/** Conservative structural summaries: changed signatures are advisory, never a proof of breakage. */
function signature(type: ts.Type, checker: ts.TypeChecker, location: ts.Node, seen: Set<ts.Type>, depth: number, budget = { remaining: 1000 }): string {
    const display = () => checker.typeToString(type, location, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias);
    if (seen.has(type) || depth > 8 || budget.remaining-- <= 0 || !(type.flags & ts.TypeFlags.Object)) return display();
    const next = new Set(seen).add(type);
    const format = (t: ts.Type) => signature(t, checker, location, next, depth + 1, budget);
    const signatures = (kind: ts.SignatureKind) => checker.getSignaturesOfType(type, kind).map((s) => ({
        text: checker.signatureToString(s, location, ts.TypeFormatFlags.NoTruncation),
        parameters: s.parameters.map((p) => format(checker.getTypeOfSymbolAtLocation(p, p.valueDeclaration ?? location))),
        returns: format(checker.getReturnTypeOfSignature(s)),
    }));
    const properties = checker.getPropertiesOfType(type).sort((a, b) => a.name.localeCompare(b.name)).map((p) => [p.name, !!(p.flags & ts.SymbolFlags.Optional), p.declarations?.some((d) => !!(ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Readonly)) ?? false, format(checker.getTypeOfSymbolAtLocation(p, p.valueDeclaration ?? location))]);
    const indices = checker.getIndexInfosOfType(type).map((i) => [format(i.keyType), format(i.type), i.isReadonly]);
    return JSON.stringify({ display: display(), calls: signatures(ts.SignatureKind.Call), constructs: signatures(ts.SignatureKind.Construct), properties, indices });
}
