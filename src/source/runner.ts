/**
 * Source plugin runner — calls each plugin's `sourceNodes` with a Gatsby-compatible
 * context object, then returns a populated node store ready for schema inference.
 *
 * Handles async plugins (e.g. gatsby-source-filesystem) that return immediately
 * and create nodes later via file-system events:
 *  1. Wait for nodes to stop arriving ("settle").
 *  2. Emit BOOTSTRAP_FINISHED on the plugin's emitter.
 *  3. Wait for any post-bootstrap nodes to settle.
 */

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { NodeStore } from './store';
import { makeGatsbyContext } from './context';
import type { HadarsSourceEntry } from '../types/hadars';

/** ms without a new createNode call before we consider the plugin settled. */
const SETTLE_IDLE_MS = 300;
/** Hard timeout — give up waiting after this many ms. */
const SETTLE_TIMEOUT_MS = 10_000;
/** Timeout for a single sourceNodes() call before we give up waiting. */
const SOURCE_NODES_TIMEOUT_MS = 30_000;

/**
 * Wait until no createNode call has been received for SETTLE_IDLE_MS,
 * or until SETTLE_TIMEOUT_MS elapses, whichever comes first.
 * Timers are unref()ed so they don't keep the process alive artificially.
 */
function waitForSettle(getLastNodeTime: () => number): Promise<void> {
    return new Promise(resolve => {
        const deadline = Date.now() + SETTLE_TIMEOUT_MS;
        const check = () => {
            const idle = Date.now() - getLastNodeTime();
            if (idle >= SETTLE_IDLE_MS || Date.now() >= deadline) {
                resolve();
            } else {
                const t = setTimeout(check, 50);
                t.unref?.();
            }
        };
        const t = setTimeout(check, SETTLE_IDLE_MS);
        t.unref?.();
    });
}

/**
 * Run a promise with a hard timeout. Rejects with a clear message if the
 * deadline is exceeded, but does not cancel the original promise.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`[hadars] "${label}" timed out after ${ms}ms`)), ms);
        t.unref?.();
        promise.then(resolve, reject).finally(() => clearTimeout(t));
    });
}

export async function runSources(
    sources: HadarsSourceEntry[],
): Promise<NodeStore> {
    const store = new NodeStore();

    for (const entry of sources) {
        const { resolve, options = {} } = entry;

        let mod: { sourceNodes?: (ctx: any, opts?: any) => Promise<void> | void };
        if (typeof resolve === 'string') {
            // Resolve from the user's project directory so the package is found
            // in their node_modules, not in the CLI's own node_modules.
            const projectRequire = createRequire(process.cwd() + '/package.json');

            // Gatsby plugins export sourceNodes from gatsby-node.js, not their
            // package main. Try gatsby-node.js first, fall back to main entry.
            let pkgPath: string;
            try {
                pkgPath = projectRequire.resolve(`${resolve}/gatsby-node`);
            } catch {
                pkgPath = projectRequire.resolve(resolve);
            }
            mod = await import(pkgPath);
        } else {
            mod = resolve as any;
        }

        if (typeof mod.sourceNodes !== 'function') {
            const name = typeof resolve === 'string' ? resolve : '(module)';
            console.warn(`[hadars] source plugin ${name} does not export sourceNodes — skipping`);
            continue;
        }

        const pluginName = typeof resolve === 'string' ? resolve : 'hadars-source';

        // Track the last time createNode was called so we can detect settling.
        let lastNodeTime = Date.now();
        const trackingStore = new Proxy(store, {
            get(target, prop) {
                if (prop === 'createNode') {
                    return (node: any) => {
                        lastNodeTime = Date.now();
                        return target.createNode(node);
                    };
                }
                return (target as any)[prop];
            },
        });

        // Real EventEmitter — plugins subscribe to BOOTSTRAP_FINISHED on this.
        const emitter = new EventEmitter();
        const ctx = makeGatsbyContext(trackingStore, pluginName, options, emitter);

        try {
            await withTimeout(
                Promise.resolve(mod.sourceNodes(ctx, options)),
                SOURCE_NODES_TIMEOUT_MS,
                `${pluginName} sourceNodes`,
            );
        } catch (err) {
            const cause = err instanceof Error ? err : new Error(String(err));
            const wrapped = new Error(
                `[hadars] source plugin "${pluginName}" threw during sourceNodes: ${cause.message}`,
            );
            wrapped.cause = cause;
            throw wrapped;
        }

        // Phase 1: wait for async initial-scan nodes (e.g. chokidar ready → createFileNode).
        await waitForSettle(() => lastNodeTime);

        // Signal Gatsby lifecycle end — some plugins create additional nodes here.
        emitter.emit('BOOTSTRAP_FINISHED');

        // Phase 2: wait for any post-bootstrap nodes to settle.
        await waitForSettle(() => lastNodeTime);
    }

    return store;
}
