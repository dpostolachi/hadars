import ts from 'typescript';
import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { HadarsManifest } from './manifest';
import type { BuildManifest } from './artifacts';
import { hash } from './identity';

export interface ModuleTypesOptions {
    manifest: HadarsManifest;
    /** The module project root; `exposes` paths and `tsConfig` resolve against it. */
    cwd: string;
    /** Declarations are written to `<outDir>/types`. */
    outDir: string;
    tsConfig?: string;
}

export interface ModuleTypes {
    /** Declaration files relative to `outDir`, entry first. */
    types: string[];
    typeApi: NonNullable<BuildManifest['typeApi']>;
}

const sorted = <T>(entries: [string, T][]) => Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

/**
 * Emits `.d.ts` files for everything a module exposes, plus an entry whose
 * namespaces mirror the runtime `getModule(name)` shape. Consumers type-check
 * against the build, not the module's sources.
 */
export function emitModuleTypes(opts: ModuleTypesOptions): ModuleTypes {
    const { manifest, cwd } = opts;
    const typesDir = path.join(opts.outDir, 'types');
    rmSync(typesDir, { recursive: true, force: true });
    mkdirSync(typesDir, { recursive: true });

    let compilerOptions: ts.CompilerOptions = {};
    // Ambient declarations (global augmentations) of the project's tsconfig apply to every source file.
    let ambient: string[] = [];
    if (opts.tsConfig) {
        const file = path.resolve(cwd, opts.tsConfig);
        const read = ts.readConfigFile(file, ts.sys.readFile);
        if (read.error) throw new Error(`Cannot read ${file}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`);
        const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file));
        compilerOptions = parsed.options;
        ambient = parsed.fileNames.filter((f) => f.endsWith('.d.ts') && !f.includes('node_modules'));
    }
    // Imports may leave the module's folder (a shared source root), so declarations are laid out from the common root.
    const root = opts.tsConfig ? path.dirname(path.resolve(cwd, opts.tsConfig)) : cwd;
    const rootDir = path.relative(root, cwd).startsWith('..') ? cwd : root;
    const entries = Object.entries(manifest.exposes).map(([key, file]) => [key, path.resolve(cwd, file)] as const);
    const program = ts.createProgram([...entries.map(([, file]) => file), ...ambient], {
        jsx: ts.JsxEmit.ReactJSX, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
        skipLibCheck: true, ...compilerOptions,
        // Overrides last: these decide where and what is emitted.
        declaration: true, emitDeclarationOnly: true, noEmit: false, outDir: typesDir, rootDir,
        incremental: false, composite: false, declarationMap: false, sourceMap: false,
    });
    // A declaration must never land outside `<outDir>/types`, e.g. next to a shared source file.
    const emitted = program.emit(undefined, (file, text) => {
        if (path.relative(typesDir, path.resolve(file)).startsWith('..')) throw new Error(`Refusing to write a declaration outside ${typesDir}: ${file}`);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, text);
    }, undefined, true);
    // Declarations are emitted despite type errors; only an emit that produced nothing is fatal.
    if (emitted.emitSkipped) {
        const first = emitted.diagnostics.find((d) => d.category === ts.DiagnosticCategory.Error) ?? emitted.diagnostics[0];
        throw new Error(`Cannot emit declarations for module "${manifest.name}": ${first ? ts.flattenDiagnosticMessageText(first.messageText, '\n') + (first.file ? ` (${first.file.fileName})` : '') : 'emit was skipped'}`);
    }

    const specifier = (file: string) => {
        const relative = path.relative(rootDir, file).replace(/\.[cm]?[jt]sx?$/, '').split(path.sep).join('/');
        return './' + relative;
    };
    writeFileSync(path.join(typesDir, 'index.d.ts'),
        entries.map(([key, file]) => `export * as ${key} from ${JSON.stringify(specifier(file))};`).join('\n') + '\n');

    const checker = program.getTypeChecker();
    const exports = sorted(entries.map(([key, file]) => {
        const source = program.getSourceFile(file);
        const symbol = source && checker.getSymbolAtLocation(source);
        const names = symbol ? checker.getExportsOfModule(symbol) : [];
        return [key, sorted(names.map((s) => {
            const target = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
            // The signature is what a consumer compiles against; registries compare it between versions.
            const signature = target.flags & ts.SymbolFlags.Value
                ? checker.typeToString(checker.getTypeOfSymbolAtLocation(target, source!), undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope)
                : (target.declarations ?? []).map((d) => d.getText().replace(/\s+/g, ' ').trim()).join(' | ');
            return [s.name, signature] as [string, string];
        }))] as [string, Record<string, string>];
    }));

    const listed = (readdirSync(typesDir, { recursive: true }) as string[])
        .map((f) => 'types/' + f.split(path.sep).join('/')).filter((f) => f.endsWith('.d.ts'));
    const files = listed.sort();
    const entry = 'types/index.d.ts';
    const types = [entry, ...files.filter((f) => f !== entry)];
    const digests = files.map((p) => [p, hash(readFileSync(path.join(opts.outDir, p)))] as const);
    return { types, typeApi: { declarationsSha256: hash(JSON.stringify(digests)), exports } };
}

/**
 * Text for a shell's `hadars-modules.d.ts`: types `getModule('name')` from each
 * module's emitted entry. `entries` maps a module name to its `types/index.d.ts`.
 */
export function shellTypesSource(entries: Record<string, string>, from: string): string {
    const lines = Object.entries(entries).sort(([a], [b]) => a < b ? -1 : 1).map(([name, file]) => {
        const rel = path.relative(from, file).replace(/\.d\.ts$/, '').split(path.sep).join('/');
        return `        ${JSON.stringify(name)}: typeof import(${JSON.stringify(rel.startsWith('.') ? rel : './' + rel)});`;
    });
    return `// Generated by hadars. Do not edit.\nexport {};\ndeclare global {\n    interface HadarsModules {\n${lines.join('\n')}\n    }\n}\n`;
}

/** Writes `file` with types for the given modules, replacing it only when the text changes. */
export function writeShellTypes(file: string, entries: Record<string, string>): boolean {
    const source = shellTypesSource(entries, path.dirname(path.resolve(file)));
    if (existsSync(file) && readFileSync(file, 'utf8') === source) return false;
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    writeFileSync(file, source);
    return true;
}
