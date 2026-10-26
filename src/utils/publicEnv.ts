/** Only names with this prefix opt in to publication. Never use it for secrets. */
const PUBLIC_NAME = /^HADARS_PUBLIC_[A-Z0-9_]+$/;
const MAX_BYTES = 32 * 1024;
const encoder = new TextEncoder();

export type PublicEnv = Record<string, string>;

/** Escape executable JSON, including script terminators and legacy line separators. */
export function publicEnvJson(values: PublicEnv): string {
    return JSON.stringify(values).replace(/[<\u2028\u2029]/g, char =>
        char === '<' ? '\\u003c' : char === '\u2028' ? '\\u2028' : '\\u2029');
}

/** Read deployment values without compile-time substitution of environment expressions. */
export function readPublicEnv(bindings?: Record<string, unknown>): PublicEnv {
    const runtime = globalThis as any;
    let source = bindings;
    if (!source) {
        try { source = runtime.Deno?.env?.toObject?.(); } catch { /* Permission denied. */ }
        source ??= runtime.process?.env ?? {};
    }
    const values: PublicEnv = Object.create(null);
    let bytes = 2; // JSON object delimiters.
    for (const name of Object.keys(source!).filter(name => PUBLIC_NAME.test(name)).sort()) {
        const value = source![name];
        if (typeof value !== 'string') continue;
        const size = encoder.encode(publicEnvJson({ [name]: value })).length;
        // Include comma overhead; measure the escaped payload, not just the source string.
        if (bytes + size > MAX_BYTES) continue;
        values[name] = value;
        bytes += size;
    }
    return values;
}

/**
 * Read a public runtime value during rendering. Pass the existing build-time
 * expression as fallback; empty runtime strings intentionally override it.
 */
export function getPublicEnv(name: string): string | undefined;
export function getPublicEnv<T>(name: string, fallback: T): string | T;
export function getPublicEnv<T>(name: string, fallback?: T): string | T | undefined {
    if (!PUBLIC_NAME.test(name)) return fallback;
    const runtime = globalThis as any;
    const values = runtime.__hadarsContext?.publicEnv
        ?? runtime.__HADARS_PUBLIC_ENV__
        ?? (typeof document === 'undefined' ? readPublicEnv() : undefined);
    const value = values && Object.hasOwn(values, name) ? values[name] : undefined;
    return typeof value === 'string' ? value : fallback;
}
