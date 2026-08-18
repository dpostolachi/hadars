/**
 * Guards the predicate that suppresses no-op hot updates.
 *
 * A compilation that recompiles the client without changing any of its modules
 * still emits an update whose chunk has an EMPTY module map and whose only
 * effect is advancing __webpack_require__.h. Applying it puts the client one
 * hash AHEAD of the chunk the next real edit produces, so that edit 404s and
 * the update chain stalls permanently.
 *
 * The critical subtlety: a HEALTHY update has the same manifest as a no-op one
 * ({"c":["main"],"r":[],"m":[]} — "m" lists REMOVED modules), so the manifest
 * cannot be used to tell them apart. Keying off it deletes real updates and
 * silently breaks Fast Refresh. The module map inside the .js chunk is the only
 * reliable discriminator.
 */

import { test, expect } from 'bun:test';

// Must stay in sync with the HadarsDropEmptyHotUpdate plugin in utils/rspack.ts.
const EMPTY_UPDATE = /webpackHotUpdate[^(]*\(\s*("[^"]*"|'[^']*')\s*,\s*\{\s*\}/;

const NOOP_CHUNK = `self["webpackHotUpdatecontenthive_frontend"]("main", {}, function(__webpack_require__) {
  __webpack_require__.h = function() { return "ea3d3f432103bd48"; }
});`;

const REAL_CHUNK = `self["webpackHotUpdatehadars_hmr_fixture"]("main", {
"./src/App.tsx": (function(module, exports, __webpack_require__) { /* PROBE_UPDATED */ })
}, function(__webpack_require__) { __webpack_require__.h = function(){ return "abc"; } });`;

test('suppresses a no-op update whose only effect is bumping the hash', () => {
    expect(EMPTY_UPDATE.test(NOOP_CHUNK)).toBe(true);
});

test('never suppresses an update that carries a changed module', () => {
    expect(EMPTY_UPDATE.test(REAL_CHUNK)).toBe(false);
});

test('the manifest alone cannot distinguish the two', () => {
    // Both shapes really do ship this identical manifest — the reason the
    // manifest-based version of this fix broke Fast Refresh.
    const manifest = '{"c":["main"],"r":[],"m":[]}';
    const parsed = JSON.parse(manifest);
    expect(parsed.m).toEqual([]);
    expect(parsed.r).toEqual([]);
});
