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
  const map: Map<object, unknown> | null = _g[MAP_KEY];
  const c = context as any;
  const prev = map && map.has(context)
    ? map.get(context)
    : ("_defaultValue" in c ? c._defaultValue : c._currentValue);
  map?.set(context, value);
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

function s(): RenderState {
  const g = globalThis as any;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { currentTreeContext: { ...EMPTY }, localIdCounter: 0, idPrefix: "" };
  }
  return g[GLOBAL_KEY] as RenderState;
}

export function resetRenderState() {
  const st = s();
  st.currentTreeContext = { ...EMPTY };
  st.localIdCounter = 0;
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
export function pushTreeContext(totalChildren: number, index: number): TreeContext {
  const st = s();
  const saved: TreeContext = { ...st.currentTreeContext };

  const baseIdWithLeadingBit = st.currentTreeContext.id;
  const baseOverflow = st.currentTreeContext.overflow;
  // Number of data bits currently stored (excludes the sentinel bit).
  const baseLength = 31 - Math.clz32(baseIdWithLeadingBit);
  // Strip the sentinel to get the pure data portion.
  let baseId = baseIdWithLeadingBit & ~(1 << baseLength);

  const slot = index + 1; // 1-indexed
  const newBits = 32 - Math.clz32(totalChildren); // bits required for the new slot
  const length = newBits + baseLength;             // total data bits after push

  if (30 < length) {
    // Overflow: flush the lowest bits of the old data to the overflow string.
    // Round down to a multiple of 5 so each base-32 character covers exactly
    // 5 bits (no fractional digits that would corrupt adjacent chars).
    const numberOfOverflowBits = baseLength - (baseLength % 5);
    const overflowStr = (baseId & ((1 << numberOfOverflowBits) - 1)).toString(32);
    baseId >>= numberOfOverflowBits;
    const newBaseLength = baseLength - numberOfOverflowBits;
    st.currentTreeContext = {
      id: (1 << (newBits + newBaseLength)) | (slot << newBaseLength) | baseId,
      overflow: overflowStr + baseOverflow,
    };
  } else {
    st.currentTreeContext = {
      id: (1 << length) | (slot << baseLength) | baseId,
      overflow: baseOverflow,
    };
  }
  return saved;
}

export function popTreeContext(saved: TreeContext) {
  s().currentTreeContext = saved;
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

export function snapshotContext(): { tree: TreeContext; localId: number } {
  const st = s();
  return { tree: { ...st.currentTreeContext }, localId: st.localIdCounter };
}

export function restoreContext(snap: { tree: TreeContext; localId: number }) {
  const st = s();
  st.currentTreeContext = { ...snap.tree };
  st.localIdCounter = snap.localId;
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

/**
 * Generate a `useId`-compatible ID for the current call site.
 *
 * Format: `«<idPrefix>R<treeId>»`  (React 19.1+)
 *   with an optional `H<n>` suffix for the n-th useId call in the same
 *   component (matching React 19's `localIdCounter` behaviour).
 *
 * React 19.1 switched from `_R_<id>_` to `«R<id>»` (U+00AB / U+00BB).
 * This matches React 19.1's `mountId` output on the Fizz SSR renderer and
 * the client hydration path, so the IDs produced here will agree with the
 * real React runtime during `hydrateRoot`.
 */
export function makeId(): string {
  const st = s();
  const treeId = getTreeId();
  const n = st.localIdCounter++;
  let id = "\u00ab" + st.idPrefix + "R" + treeId;
  if (n > 0) id += "H" + n.toString(32);
  return id + "\u00bb";
}
