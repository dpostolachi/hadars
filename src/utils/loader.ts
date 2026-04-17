/**
 * Rspack/webpack loader that applies two source-level transforms based on the
 * compilation target (web vs node):
 *
 * ── loadModule('path') ────────────────────────────────────────────────────────
 *  - web  (browser): replaced with `import('./path')` — rspack treats this as
 *    a true dynamic import and splits the module into a separate chunk.
 *  - node (SSR):     replaced with `Promise.resolve(require('./path'))` —
 *    bundled statically, wrapped in Promise.resolve to keep the API shape.
 *
 * ── useServerData(key, fn) ───────────────────────────────────────────────────
 *  - web  (browser): the second argument `fn` is replaced with `()=>undefined`.
 *    `fn` is a server-only callback that may reference internal endpoints,
 *    credentials, or other sensitive information. It is never called in the
 *    browser (the hook returns the SSR-cached value immediately), but without
 *    this transform it would still be compiled into the client bundle — exposing
 *    those details to anyone who inspects the JS. Stripping it at bundle time
 *    prevents the leak entirely.
 *  - node (SSR): kept as-is — the real fn is needed to fetch data.
 *
 * Transformation strategy:
 *   Primary  — SWC AST parsing via @swc/core. Handles any valid TS/JS syntax
 *              including arbitrarily-nested generics, comments, and string
 *              literals that contain the function names.
 *   Fallback — Scanner-based transform used when @swc/core is unavailable.
 *
 * Example:
 *
 *   // Source (shared component):
 *   const user = useServerData('user', () => db.getUser(req.userId));
 *
 *   // Client bundle after transform:
 *   const user = useServerData('user', ()=>undefined);
 *
 *   // Server bundle (unchanged):
 *   const user = useServerData('user', () => db.getUser(req.userId));
 */

export default function loader(this: any, source: string): string {
    // Prefer the explicit `server` option injected by rspack.ts over the legacy
    // `this.target` heuristic (which is unreliable when `target` is not set in
    // the rspack config — rspack then reports 'web' for every build).
    const opts = this.getOptions?.() ?? {};
    const isServer: boolean = (typeof opts.server === 'boolean')
        ? opts.server
        : (this.target === 'node' || this.target === 'async-node');
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
        if (!callee || callee.type !== 'Identifier') return;

        const name: string = callee.value;

        // ── useServerData(fn) — strip fn on client builds ────────────────────
        if (!isServer && name === 'useServerData') {
            const args: any[] = node.arguments;
            if (!args || args.length < 1) return;
            const fnArg = args[0].expression ?? args[0];
            // Normalise to 0-based local byte offsets and replace with stub.
            replacements.push({
                start: fnArg.span.start - fileOffset,
                end: fnArg.span.end - fileOffset,
                replacement: '()=>undefined',
            });
            return;
        }

        // ── loadModule(path) ─────────────────────────────────────────────────
        if (name !== 'loadModule') return;

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
            // Dynamic (non-literal) path — emit a build warning.
            // The module will NOT be bundled and build-time transforms (SWC plugins,
            // Relay, etc.) will not run. The path must be a string literal at the
            // loadModule() call site. Wrap helper functions to accept a factory
            // instead: const lazy = (fn) => React.lazy(fn);
            //           const Page = lazy(() => loadModule('./Page'));
            const start0 = node.span.start - fileOffset;
            const bytesBefore = srcBytes.slice(0, start0);
            const line = bytesBefore.toString('utf8').split('\n').length;
            this.emitWarning(
                new Error(
                    `[hadars] loadModule() called with a dynamic (non-literal) path at ${resourcePath}:${line}. ` +
                    `The module will not be bundled. Use a string literal: loadModule('./myPage').`
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

/**
 * Scan forward from `pos` in `source`, skipping over a balanced JS expression
 * (handles nested parens/brackets/braces and string literals).
 * Returns the index of the first character AFTER the expression
 * (i.e. the position of the trailing `,` or `)` at depth 0).
 */
function scanExpressionEnd(source: string, pos: number): number {
    let depth = 0;
    let i = pos;
    while (i < source.length) {
        const ch = source[i]!;
        if (ch === '(' || ch === '[' || ch === '{') { depth++; i++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') {
            if (depth === 0) break; // end of expression — closing delimiter of outer call
            depth--; i++; continue;
        }
        if (ch === ',' && depth === 0) break; // end of expression — next argument
        // String / template literals
        if (ch === '"' || ch === "'" || ch === '`') {
            const q = ch; i++;
            while (i < source.length && source[i] !== q) {
                if (source[i] === '\\') i++; // escape sequence
                i++;
            }
            i++; // closing quote
            continue;
        }
        // Line comment
        if (ch === '/' && source[i + 1] === '/') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }
        // Block comment
        if (ch === '/' && source[i + 1] === '*') {
            i += 2;
            while (i + 1 < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        i++;
    }
    return i;
}

/**
 * Strip the `fn` argument from `useServerData(fn)` calls in client builds.
 * Uses a character-level scanner to handle arbitrary fn expressions (arrow
 * functions with nested calls, async functions, object literals, etc.).
 */
function stripUseServerDataFns(source: string): string {
    // Match `useServerData` + optional generic + opening paren
    const CALL_RE = /\buseServerData\s*(?:<(?:[^<>]|<[^<>]*>)*>\s*)?\(/g;
    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    CALL_RE.lastIndex = 0;
    while ((match = CALL_RE.exec(source)) !== null) {
        let i = match.index + match[0].length;
        // Skip whitespace before fn arg
        while (i < source.length && /\s/.test(source[i]!)) i++;
        const fnStart = i;
        // Scan to end of fn argument
        const fnEnd = scanExpressionEnd(source, i);
        if (fnEnd <= fnStart) continue;
        // Emit everything up to fn, then the stub, skip the original fn
        result += source.slice(lastIndex, fnStart) + '()=>undefined';
        lastIndex = fnEnd;
        // Advance regex past this call to avoid re-matching
        CALL_RE.lastIndex = fnEnd;
    }
    return lastIndex === 0 ? source : result + source.slice(lastIndex);
}

function regexTransform(this: any, source: string, isServer: boolean, resourcePath: string): string {
    let transformed = source.replace(LOAD_MODULE_RE, (_match, quote, modulePath) =>
        isServer
            ? `Promise.resolve(require(${quote}${modulePath}${quote}))`
            : `import(${quote}${modulePath}${quote})`
    );

    // Strip server-only fn arguments from useServerData on client builds.
    if (!isServer) {
        transformed = stripUseServerDataFns(transformed);
    }

    // Warn for any remaining dynamic calls
    let match: RegExpExecArray | null;
    DYNAMIC_LOAD_MODULE_RE.lastIndex = 0;
    while ((match = DYNAMIC_LOAD_MODULE_RE.exec(transformed)) !== null) {
        const line = transformed.slice(0, match.index).split('\n').length;
        this.emitWarning(
            new Error(
                `[hadars] loadModule() called with a dynamic (non-literal) path at ${resourcePath}:${line}. ` +
                `The module will not be bundled. Use a string literal: loadModule('./myPage').`
            )
        );
    }

    return transformed;
}
