/** True when running inside Bun. */
export const isBun = typeof (globalThis as any).Bun !== 'undefined';

/** True when running inside Deno. */
export const isDeno = typeof (globalThis as any).Deno !== 'undefined';

/** True when running inside Node.js (not Bun, not Deno). */
export const isNode = !isBun && !isDeno;

/** Returns a human-readable runtime identifier. */
export const getRuntimeName = (): 'bun' | 'deno' | 'node' =>
    isBun ? 'bun' : isDeno ? 'deno' : 'node';

/** Returns a version string for the current runtime, e.g. "Bun 1.1.0". */
export const getRuntimeVersion = (): string => {
    if (isBun) return `Bun ${(globalThis as any).Bun.version}`;
    if (isDeno) return `Deno ${(globalThis as any).Deno.version.deno}`;
    return `Node.js ${process.version}`;
};
