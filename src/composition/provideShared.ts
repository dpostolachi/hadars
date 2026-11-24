import { SHARED_GLOBAL } from './constants';

/**
 * Called by the host before loading any module. Keys are package names
 * (`react`, `react/jsx-runtime`, ...); values are the host's module namespaces.
 *
 * The shared packages live on `globalThis`, so one process (or page) hosts one
 * composition: two shells with different runtimes would overwrite each other.
 */
export function provideShared(shared: Record<string, unknown>): void {
    (globalThis as any)[SHARED_GLOBAL] = { ...(globalThis as any)[SHARED_GLOBAL], ...shared };
}
