/**
 * Render-time context for tree-position-based `useId` and React Context values.
 *
 * State lives on `globalThis` rather than module-level variables so that
 * multiple slim-react instances (the render worker's direct import and the
 * SSR bundle's bundled copy) share the same singletons without coordination.
 *
 * Context values are stored in a plain Map that is created per render call.
 * Node.js is single-threaded: only one render is executing between any two
 * await points. The renderer captures the map reference before every await
 * and restores it in the continuation, so concurrent renders stay isolated
 * without any external dependencies.
 */

import { createRequire as _nodeCreateRequire } from 'node:module';

// The context map for the render that is currently executing (between awaits).
// Kept on globalThis so both slim-react instances share the same slot.
const MAP_KEY = "__slimReactContextMap";
const _g = globalThis as any;
if (!("__slimReactContextMap" in _g)) _g[MAP_KEY] = null;

/**
 * Swap in a new context map and return the previous one.
 * Called at render entry-points and at every await/then continuation to
 * restore the correct map for the resuming render.
 */
export function swapContextMap(
  map: Map<object, unknown> | null,
): Map<object, unknown> | null {
  const prev: Map<object, unknown> | null = _g[MAP_KEY];
  _g[MAP_KEY] = map;
  return prev;
}

/** Return the active map without changing it (used to capture before an await). */
export function captureMap(): Map<object, unknown> | null {
  return _g[MAP_KEY];
}

const UNSUSPEND_KEY = "__hadarsUnsuspend";

/**
 * Capture the current __hadarsUnsuspend slot alongside captureMap() before
 * an async boundary.  Because useServerData reads this global, concurrent
 * renders would corrupt each other's cache if it weren't restored after every
 * await continuation — exactly like the context map itself.
 */
export function captureUnsuspend(): unknown {
  return _g[UNSUSPEND_KEY];
}

/** Restore a previously captured __hadarsUnsuspend slot after an await. */
export function restoreUnsuspend(u: unknown): void {
  _g[UNSUSPEND_KEY] = u;
}

/** Read the current value for a context within the active render. */
export function getContextValue<T>(context: object): T {
  const map: Map<object, unknown> | null = _g[MAP_KEY];
  if (map && map.has(context)) return map.get(context) as T;
  const c = context as any;
  return ("_defaultValue" in c ? c._defaultValue : c._currentValue) as T;
}

/**
 * Push a new Provider value into the active map.
 * Returns the previous value so the caller can restore it on exit.
 */
export function pushContextValue(context: object, value: unknown): unknown {
  let map: Map<object, unknown> | null = _g[MAP_KEY];
  // Lazily create the Map on the first Provider encountered — renders without
  // any Context.Provider never allocate a Map at all.
  if (map === null) {
    map = new Map();
    _g[MAP_KEY] = map;
  }
  const c = context as any;
  const prev = map.has(context)
    ? map.get(context)
    : ("_defaultValue" in c ? c._defaultValue : c._currentValue);
  map.set(context, value);
  return prev;
}

/** Restore a previously saved context value (called by Provider on exit). */
export function popContextValue(context: object, prev: unknown): void {
  (_g[MAP_KEY] as Map<object, unknown> | null)?.set(context, prev);
}

// TreeContext matches React 19's representation exactly:
// `id` is a packed bitfield with a leading sentinel `1` bit followed by tree
// path slots. The most-recently-pushed slot occupies the HIGHEST non-sentinel
// bits, matching React 19's Fizz `pushTreeContext` bit-packing order.
// `overflow` accumulates segments that no longer fit in the 30-bit budget,
// prepended newest-first (same as React 19).
export interface TreeContext {
  id: number;       // bitfield with sentinel; 1 = empty (just sentinel, no data)
  overflow: string; // base-32 partial path segments that overflowed
}

interface RenderState {
  currentTreeContext: TreeContext;
  localIdCounter: number;
  idPrefix: string;
}

const GLOBAL_KEY = "__slimReactRenderState";
// React 19's initial context is { id: 1, overflow: "" } — sentinel bit only.
const EMPTY: TreeContext = { id: 1, overflow: "" };

/**
 * Module-level cache for the shared RenderState singleton.
 * Avoids a `globalThis[key]` property lookup on every push/pop/reset call
 * (which happens multiple times per component during rendering).
 * Both slim-react instances (direct import + SSR bundle copy) initialise the
 * same `globalThis[GLOBAL_KEY]` object and then each cache that same reference,
 * so correctness is preserved.
 */
let _stateCache: RenderState | null = null;

function s(): RenderState {
  if (_stateCache !== null) return _stateCache;
  if (!_g[GLOBAL_KEY]) {
    _g[GLOBAL_KEY] = { currentTreeContext: { ...EMPTY }, localIdCounter: 0, idPrefix: "" };
  }
  _stateCache = _g[GLOBAL_KEY] as RenderState;
  return _stateCache;
}

/**
 * Flat primitive stacks for pushTreeContext / popTreeContext.
 *
 * Instead of allocating a new `{ id, overflow }` object on every array child
 * (which is the hot path — called once per child in every array render), we
 * save the two scalar fields into parallel pre-allocated arrays and return a
 * numeric depth index.  No heap objects are allocated in the push. Both arrays
 * grow lazily and are never shrunk, so after a few renders they stop growing.
 */
const _treeIdStack: number[]       = [];
const _treeOvStack: string[]        = [];
let   _treeDepth   = 0;

export function resetRenderState(idPrefix = "") {
  const st = s();
  // Mutate in place — avoids allocating a new TreeContext object each render.
  st.currentTreeContext.id       = EMPTY.id;
  st.currentTreeContext.overflow = EMPTY.overflow;
  st.localIdCounter = 0;
  st.idPrefix       = idPrefix;
  _treeDepth        = 0;
}

export function setIdPrefix(prefix: string) {
  s().idPrefix = prefix;
}

/**
 * Push a new level onto the tree context — matches React 19's Fizz
 * `pushTreeContext` exactly:
 *   - new slot occupies the HIGHER bit positions (above the old base data)
 *   - on overflow, the LOWEST bits of the old data move to the overflow string
 *     (rounded to a multiple of 5 so base-32 digits align on byte boundaries)
 */
/**
 * Push a new tree-context level.  Returns a numeric depth token (not an
 * object) so the caller can pop with zero heap allocation in the common case.
 */
export function pushTreeContext(totalChildren: number, index: number): number {
  const st  = s();
  const ctx = st.currentTreeContext;
  const depth = _treeDepth++;

  // Save current scalars into the flat stacks — no object allocation.
  _treeIdStack[depth] = ctx.id;
  _treeOvStack[depth] = ctx.overflow;

  const baseIdWithLeadingBit = ctx.id;
  const baseOverflow         = ctx.overflow;
  const baseLength = 31 - Math.clz32(baseIdWithLeadingBit);
  let   baseId     = baseIdWithLeadingBit & ~(1 << baseLength);

  const slot    = index + 1;
  const newBits = 32 - Math.clz32(totalChildren);
  const length  = newBits + baseLength;

  // Mutate currentTreeContext in place — avoids allocating a new object.
  if (30 < length) {
    const overflowBits = baseLength - (baseLength % 5);
    const overflowStr  = (baseId & ((1 << overflowBits) - 1)).toString(32);
    baseId >>= overflowBits;
    const newBaseLength = baseLength - overflowBits;
    ctx.id       = (1 << (newBits + newBaseLength)) | (slot << newBaseLength) | baseId;
    ctx.overflow = overflowStr + baseOverflow;
  } else {
    ctx.id       = (1 << length) | (slot << baseLength) | baseId;
    ctx.overflow = baseOverflow;
  }
  return depth;
}

export function popTreeContext(depth: number): void {
  const ctx    = s().currentTreeContext;
  ctx.id       = _treeIdStack[depth]!;
  ctx.overflow = _treeOvStack[depth]!;
  _treeDepth   = depth;
}

export function pushComponentScope(): number {
  const st = s();
  const saved = st.localIdCounter;
  st.localIdCounter = 0;
  return saved;
}

export function popComponentScope(saved: number) {
  s().localIdCounter = saved;
}

/** True if the current component has called useId at least once. */
export function componentCalledUseId(): boolean {
  return s().localIdCounter > 0;
}

export interface ContextSnapshot {
  tree: TreeContext;
  localId: number;
  treeDepth: number;
  /** Saved parent-context id values for the stack slots 0..treeDepth-1.
   *  Required so that concurrent renders cannot corrupt popTreeContext calls
   *  that run after an await continuation. */
  idStack: number[];
  ovStack: string[];
}

export function snapshotContext(): ContextSnapshot {
  const st    = s();
  const ctx   = st.currentTreeContext;
  const depth = _treeDepth;
  return {
    tree:      { id: ctx.id, overflow: ctx.overflow },
    localId:   st.localIdCounter,
    treeDepth: depth,
    // Snapshot the live stack so that popTreeContext reads correct saved values
    // even if another concurrent render's resetRenderState stomped the arrays.
    idStack:   _treeIdStack.slice(0, depth),
    ovStack:   _treeOvStack.slice(0, depth),
  };
}

export function restoreContext(snap: ContextSnapshot): void {
  const st  = s();
  const ctx = st.currentTreeContext;
  ctx.id            = snap.tree.id;
  ctx.overflow      = snap.tree.overflow;
  st.localIdCounter = snap.localId;
  _treeDepth        = snap.treeDepth;
  // Restore the stack so subsequent popTreeContext calls see the right values.
  for (let i = 0; i < snap.treeDepth; i++) {
    _treeIdStack[i] = snap.idStack[i]!;
    _treeOvStack[i] = snap.ovStack[i]!;
  }
}

/**
 * Produce the base-32 tree path string from the current context.
 * Strips the sentinel bit then concatenates stripped_id + overflow —
 * the same formula React 19 uses in both its Fizz SSR renderer and
 * the client-side `mountId`.
 */
function getTreeId(): string {
  const { id, overflow } = s().currentTreeContext;
  if (id === 1) return overflow; // sentinel only → no local path segment
  const stripped = (id & ~(1 << (31 - Math.clz32(id)))).toString(32);
  return stripped + overflow;
}

declare const __HADARS_REACT_MAJOR__: string | number | undefined;

// Resolved once at module evaluation.
// Priority:
//   1. Compile-time rspack define (__HADARS_REACT_MAJOR__) — always present in
//      rspack-built SSR bundles where `react` is aliased to slim-react.
//   2. bare require('react').version — works in CJS and Bun.
//   3. createRequire fallback — for strict Node.js ESM where bare require is
//      unavailable. Uses process.cwd() as the resolution base so monorepo
//      hoisting is respected automatically.
//   4. { major: 19, version: '19.1.1' } — last-resort default.
const _detectReact = (): { major: number; version: string } => {
  if (typeof __HADARS_REACT_MAJOR__ !== 'undefined') {
    const major = parseInt(String(__HADARS_REACT_MAJOR__), 10);
    return {
      major,
      // Exact patch version is unknown from the define alone; use a
      // representative fallback. Most libraries only check the major.
      version: major < 19 ? '18.3.1' : '19.1.1',
    };
  }
  const parse = (ver: string) => ({ major: parseInt(ver.split('.')[0]!, 10), version: ver });
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return parse((require('react') as { version: string }).version);
  } catch {}
  try {
    const req = _nodeCreateRequire(process.cwd() + '/__hadars__.js');
    return parse((req('react') as { version: string }).version);
  } catch {}
  return { major: 19, version: '19.1.1' };
};

const _react = _detectReact();
export const REACT_MAJOR: number = _react.major;
export const REACT_VERSION: string = _react.version;

/**
 * Generate a `useId`-compatible ID for the current call site.
 *
 * React 18 format : `:<idPrefix>R<treeId>:`  (colon-delimited)
 * React 19 format : `_R_<idPrefix><treeId>_` (underscore-delimited)
 *
 * The format must match what `hydrateRoot` produces on the client side so that
 * SSR-generated IDs agree with client React during hydration.
 */
export function makeId(): string {
  const st = s();
  const treeId = getTreeId();
  const n = st.localIdCounter++;
  const suffix = n > 0 ? "H" + n.toString(32) : "";
  if (REACT_MAJOR < 19) {
    return ":" + st.idPrefix + "R" + treeId + suffix + ":";
  }
  return "_R_" + st.idPrefix + treeId + suffix + "_";
}
