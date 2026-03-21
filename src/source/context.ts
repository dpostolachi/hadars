/**
 * Gatsby sourceNodes context shim.
 *
 * Gatsby passes a rich object to each source plugin's `sourceNodes` function.
 * We implement the subset that the vast majority of CMS source plugins actually
 * use so that existing plugins work without modification.
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { NodeStore, HadarsNode } from './store';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GatsbyCache {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
}

export interface GatsbyReporter {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, err?: Error): void;
    panic(message: string, err?: Error): never;
    activityTimer(name: string): { start(): void; end(): void };
    verbose(message: string): void;
}

export interface GatsbyActions {
    createNode(node: HadarsNode): void;
    deleteNode(node: { id: string }): void;
    touchNode(node: { id: string }): void;
}

export interface GatsbyNodeHelpers {
    actions: GatsbyActions;
    createNodeId(input: string): string;
    createContentDigest(content: unknown): string;
    getNode(id: string): HadarsNode | undefined;
    getNodes(): HadarsNode[];
    getNodesByType(type: string): HadarsNode[];
    cache: GatsbyCache;
    reporter: GatsbyReporter;
    // Gatsby passes these; many plugins destructure but never call them
    store: unknown;
    emitter: unknown;
    tracing: unknown;
    schema: unknown;
    /** Available in Gatsby 4+ — mostly unused by source plugins. */
    parentSpan: unknown;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function makeGatsbyContext(
    store: NodeStore,
    pluginName: string,
    pluginOptions: Record<string, unknown> = {},
    emitter: EventEmitter = new EventEmitter(),
): GatsbyNodeHelpers {
    // A simple in-memory cache per plugin instance
    const cacheMap = new Map<string, unknown>();
    const cache: GatsbyCache = {
        get: (key) => Promise.resolve(cacheMap.get(key)),
        set: (key, value) => { cacheMap.set(key, value); return Promise.resolve(); },
    };

    const reporter: GatsbyReporter = {
        info:    (msg) => console.log(`[${pluginName}] ${msg}`),
        warn:    (msg) => console.warn(`[${pluginName}] WARN: ${msg}`),
        error:   (msg, err) => console.error(`[${pluginName}] ERROR: ${msg}`, err ?? ''),
        panic:   (msg, err) => { console.error(`[${pluginName}] PANIC: ${msg}`, err ?? ''); process.exit(1); },
        verbose: (msg) => { if (process.env.HADARS_VERBOSE) console.log(`[${pluginName}] ${msg}`); },
        activityTimer: (name) => ({
            start: () => { if (process.env.HADARS_VERBOSE) console.log(`[${pluginName}] ▶ ${name}`); },
            end:   () => { if (process.env.HADARS_VERBOSE) console.log(`[${pluginName}] ■ ${name}`); },
        }),
        // Gatsby 4+ reporter extras — used by some plugins but safe to no-op
        setErrorMap: () => {},
        log:         (msg: string) => console.log(`[${pluginName}] ${msg}`),
        success:     (msg: string) => console.log(`[${pluginName}] ✓ ${msg}`),
    } as any;

    const actions: GatsbyActions = {
        createNode: (node) => store.createNode(node),
        deleteNode: ({ id }) => {
            // NodeStore doesn't expose delete — it's rarely needed by source plugins
            // on first run, so we silently no-op. A full implementation would add
            // store.deleteNode().
        },
        touchNode: () => { /* no-op — only relevant for Gatsby's caching layer */ },
    };

    return {
        actions,
        createNodeId:       (input) => createHash('sha256').update(pluginName + input).digest('hex'),
        createContentDigest: (content) => {
            const str = typeof content === 'string' ? content : JSON.stringify(content);
            return createHash('md5').update(str).digest('hex');
        },
        getNode:         (id) => store.getNode(id),
        getNodes:        ()   => store.getNodes(),
        getNodesByType:  (t)  => store.getNodesByType(t),
        cache,
        reporter,
        // Stubs for rarely-used Gatsby internals that plugins may destructure
        store:      {},
        emitter,
        tracing:    { startSpan: () => ({ finish: () => {} }) },
        schema:     {},
        parentSpan: null,
    };
}
