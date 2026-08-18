/**
 * Guards the predicate that drops phantom file removals.
 *
 * A "phantom removal" is a path the watcher reports in `removedFiles` while the
 * file is still on disk. Acting on one costs a compilation for no change, and
 * every spurious compilation advances the client hash: a browser connecting
 * afterwards holds a hash whose update chunk was never emitted, so its first
 * edit 404s and HMR stalls for the rest of the session. One is enough.
 *
 * Observed with @swc/plugin-relay, which emits non-normalised import paths
 * (`src/components/./__generated__/X.graphql.ts`). rspack records the dependency
 * under one path shape, re-resolves it under another, and concludes 27 present
 * files vanished.
 *
 * The critical subtlety: this reasoning applies to REMOVALS only. A removal is a
 * past-tense claim about existence and is directly checkable — if the file is
 * there, the claim is false. A modification is not: real content change can
 * arrive behind a timestamp the guard would have no way to disprove. Extending
 * this to `modifiedFiles` would drop genuine edits and silently break HMR, which
 * is the failure this exists to prevent.
 */

import { test, expect } from 'bun:test';
import { dropPhantomRemovals } from '../src/utils/rspack';

const PRESENT = '/proj/src/components/./__generated__/X.graphql.ts';
const GONE = '/proj/src/deleted.ts';

// Stands in for existsSync: only PRESENT is on disk.
const exists = (p: string) => p === PRESENT;

test('drops a removal for a file that is still on disk', () => {
    const removed = new Set([PRESENT]);
    const dropped = dropPhantomRemovals(removed, exists);
    expect(dropped).toEqual([PRESENT]);
    expect(removed.size).toBe(0);
});

test('keeps a removal for a file that is genuinely gone', () => {
    const removed = new Set([GONE]);
    const dropped = dropPhantomRemovals(removed, exists);
    expect(dropped).toEqual([]);
    expect(removed.has(GONE)).toBe(true);
});

test('separates phantom from real when both are reported together', () => {
    // The case that matters: a real deletion must survive alongside phantoms,
    // or the guard would suppress a compilation that genuinely needed to run.
    const removed = new Set([PRESENT, GONE]);
    const dropped = dropPhantomRemovals(removed, exists);
    expect(dropped).toEqual([PRESENT]);
    expect([...removed]).toEqual([GONE]);
});

test('treats an unreadable path as genuinely removed', () => {
    // The guard must never swallow an event it cannot disprove — a throwing
    // existence check (permissions, a race) has to fall through as a real
    // removal rather than be silently dropped.
    const removed = new Set([GONE]);
    const dropped = dropPhantomRemovals(removed, () => { throw new Error('EACCES'); });
    expect(dropped).toEqual([]);
    expect(removed.has(GONE)).toBe(true);
});

test('handles an absent or empty removal set', () => {
    expect(dropPhantomRemovals(undefined, exists)).toEqual([]);
    expect(dropPhantomRemovals(new Set(), exists)).toEqual([]);
});

test('reproduces the reported case: many phantoms, none real', () => {
    // 27 Relay artifacts reported removed, all present. Before the guard this
    // triggered the compilation that desynchronised the client hash.
    const artifacts = Array.from({ length: 27 }, (_, i) =>
        `/proj/src/mutations/./__generated__/M${i}.graphql.ts`);
    const removed = new Set(artifacts);
    const dropped = dropPhantomRemovals(removed, () => true);
    expect(dropped.length).toBe(27);
    expect(removed.size).toBe(0);
});
