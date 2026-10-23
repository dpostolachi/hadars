import { SHARED_GLOBAL } from './constants';

/**
 * Called by the host before loading any module. Keys are package names
 * (`react`, `react/jsx-runtime`, ...); values are the host's module namespaces.
 */
export function provideShared(shared: Record<string, unknown>): void {
    (globalThis as any)[SHARED_GLOBAL] = { ...(globalThis as any)[SHARED_GLOBAL], ...shared };
}
