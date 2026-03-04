/**
 * Rspack/webpack loader that transforms `loadModule('path')` calls based on
 * the compilation target:
 *
 *  - web  (browser): replaced with `import('./path')` — rspack treats this as
 *    a true dynamic import and splits the module into a separate chunk.
 *
 *  - node (SSR):     replaced with `Promise.resolve(require('./path'))` —
 *    rspack bundles the module statically so it is always available
 *    synchronously on the server, wrapped in Promise.resolve to keep the
 *    API shape identical to the client side.
 *
 * Transformation strategy:
 *   Primary  — SWC AST parsing via @swc/core. Handles any valid TS/JS syntax
 *              including arbitrarily-nested generics, comments, and string
 *              literals that contain the text "loadModule".
 *   Fallback — Regex transform used when @swc/core is unavailable.
 *
 * Example usage:
 *
 *   import { loadModule } from 'hadars';
 *
 *   // Code-split React component (wrap with React.lazy + Suspense):
 *   const MyComp = React.lazy(() => loadModule('./MyComp'));
 *
 *   // Dynamic module load:
 *   const { default: fn } = await loadModule('./heavyUtil');
 */

export default function loader(this: any, source: string): string {
    const isServer = this.target === 'node' || this.target === 'async-node';
    const resourcePath: string = this.resourcePath ?? this.resource ?? '(unknown)';

    let swc: any;
    try {
        swc = require('@swc/core');
    } catch {
        return regexTransform.call(this, source, isServer, resourcePath);
    }

    return swcTransform.call(this, swc, source, isServer, resourcePath);
}

// ---------------------------------------------------------------------------
// SWC AST transform
// ---------------------------------------------------------------------------

function swcTransform(this: any, swc: any, source: string, isServer: boolean, resourcePath: string): string {
    const isTs = /\.[mc]?tsx?$/.test(resourcePath);
    const isTsx = /\.(tsx|jsx)$/.test(resourcePath);

    let ast: any;
    try {
        ast = swc.parseSync(source, {
            syntax: isTs ? 'typescript' : 'ecmascript',
            tsx: isTsx,
        });
    } catch {
        // Unparseable file (e.g., exotic syntax) — fall back to regex
        return regexTransform.call(this, source, isServer, resourcePath);
    }

    // SWC spans use 1-based byte offsets into a GLOBAL SourceMap that
    // accumulates across parseSync calls.
    //
    // `ast.span.start` = global position of the FIRST meaningful (non-comment,
    //   non-whitespace) token.  Subtract the leading non-code bytes to get the
    //   true global start of byte 0 of this source file.
    //
    // We do NOT use `ast.span.end - srcBytes.length` because `ast.span.end`
    // only reaches the last AST token and does not include trailing whitespace
    // or newlines — causing a systematic off-by-one for the typical file that
    // ends with `\n`.
    const srcBytes = Buffer.from(source, 'utf8');
    const fileOffset = ast.span.start - countLeadingNonCodeBytes(source);

    const replacements: Array<{ start: number; end: number; replacement: string }> = [];

    walkAst(ast, (node: any) => {
        if (node.type !== 'CallExpression') return;

        const callee = node.callee;
        if (!callee || callee.type !== 'Identifier' || callee.value !== 'loadModule') return;

        const args: any[] = node.arguments;
        if (!args || args.length === 0) return;

        const firstArg = args[0].expression ?? args[0];

        let modulePath: string;
        let quoteChar: string;

        if (firstArg.type === 'StringLiteral') {
            modulePath = firstArg.value;
            // The quote char (' " `) is always ASCII so byte index == char index here.
            const quoteByteIdx = firstArg.span.start - fileOffset;
            quoteChar = String.fromCharCode(srcBytes[quoteByteIdx]!);
        } else if (
            firstArg.type === 'TemplateLiteral' &&
            firstArg.expressions.length === 0 &&
            firstArg.quasis.length === 1
        ) {
            // No-interpolation template literal: `./path`
            modulePath = firstArg.quasis[0].raw;
            quoteChar = '`';
        } else {
            // Dynamic (non-literal) path — emit a build warning
            const start0 = node.span.start - fileOffset;
            const bytesBefore = srcBytes.slice(0, start0);
            const line = bytesBefore.toString('utf8').split('\n').length;
            this.emitWarning(
                new Error(
                    `[hadars] loadModule() called with a dynamic (non-literal) path at ${resourcePath}:${line}. ` +
                    `Only string-literal paths are transformed by the loader; dynamic calls fall back to runtime import().`
                )
            );
            return;
        }
        const replacement = isServer
            ? `Promise.resolve(require(${quoteChar}${modulePath}${quoteChar}))`
            : `import(${quoteChar}${modulePath}${quoteChar})`;

        // Normalise to 0-based local byte offsets for Buffer.slice
        replacements.push({ start: node.span.start - fileOffset, end: node.span.end - fileOffset, replacement });
    });

    if (replacements.length === 0) return source;

    // Apply replacements from last to first so earlier byte offsets stay valid
    replacements.sort((a, b) => b.start - a.start);

    let result = srcBytes;
    for (const { start, end, replacement } of replacements) {
        result = Buffer.concat([result.slice(0, start), Buffer.from(replacement, 'utf8'), result.slice(end)]);
    }
    return result.toString('utf8');
}

// Minimal recursive AST walker — visits every node depth-first.
function walkAst(node: any, visit: (n: any) => void): void {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const key of Object.keys(node)) {
        if (key === 'span' || key === 'type' || key === 'ctxt') continue;
        const val = node[key];
        if (Array.isArray(val)) {
            for (const child of val) walkAst(child, visit);
        } else if (val && typeof val === 'object') {
            walkAst(val, visit);
        }
    }
}

// Returns the number of leading bytes that are pure whitespace / comments /
// shebangs — i.e. bytes before the first actual code token.  Used to anchor
// SWC's accumulated global span offsets back to byte-0 of this source file.
function countLeadingNonCodeBytes(source: string): number {
    let i = 0;
    while (i < source.length) {
        // Whitespace
        if (source[i] === ' ' || source[i] === '\t' || source[i] === '\r' || source[i] === '\n') {
            i++;
            continue;
        }
        // Line comment  //...
        if (source[i] === '/' && source[i + 1] === '/') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }
        // Block comment  /* ... */
        if (source[i] === '/' && source[i + 1] === '*') {
            i += 2;
            while (i + 1 < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
            if (i + 1 < source.length) i += 2;
            continue;
        }
        // Shebang  #!...  (only valid at position 0)
        if (i === 0 && source[i] === '#' && source[i + 1] === '!') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }
        break;
    }
    // SWC spans are UTF-8 byte offsets, but `i` here is a char index.
    // Return the byte length of the leading non-code prefix.
    return Buffer.byteLength(source.slice(0, i), 'utf8');
}

// ---------------------------------------------------------------------------
// Regex fallback (used when @swc/core is not available)
// ---------------------------------------------------------------------------

// Matches loadModule('./path') with optional TypeScript generic (up to 2 levels
// of nesting). Captures: group 1 = quote char, group 2 = module path.
const LOAD_MODULE_RE =
    /\bloadModule\s*(?:<(?:[^<>]|<[^<>]*>)*>\s*)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)/gs;

// Matches any remaining loadModule( that was NOT handled by the regex above
// (i.e. a dynamic / non-literal path argument).
const DYNAMIC_LOAD_MODULE_RE = /\bloadModule\s*(?:<(?:[^<>]|<[^<>]*>)*>\s*)?\(/g;

function regexTransform(this: any, source: string, isServer: boolean, resourcePath: string): string {
    const transformed = source.replace(LOAD_MODULE_RE, (_match, quote, modulePath) =>
        isServer
            ? `Promise.resolve(require(${quote}${modulePath}${quote}))`
            : `import(${quote}${modulePath}${quote})`
    );

    // Warn for any remaining dynamic calls
    let match: RegExpExecArray | null;
    DYNAMIC_LOAD_MODULE_RE.lastIndex = 0;
    while ((match = DYNAMIC_LOAD_MODULE_RE.exec(transformed)) !== null) {
        const line = transformed.slice(0, match.index).split('\n').length;
        this.emitWarning(
            new Error(
                `[hadars] loadModule() called with a dynamic (non-literal) path at ${resourcePath}:${line}. ` +
                `Only string-literal paths are transformed by the loader; dynamic calls fall back to runtime import().`
            )
        );
    }

    return transformed;
}
