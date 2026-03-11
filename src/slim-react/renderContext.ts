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

export interface TreeContext {
  id: number;
  overflow: string;
  bits: number;
}

interface RenderState {
  currentTreeContext: TreeContext;
  localIdCounter: number;
  idPrefix: string;
}

const GLOBAL_KEY = "__slimReactRenderState";
const EMPTY: TreeContext = { id: 0, overflow: "", bits: 0 };

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

export function pushTreeContext(totalChildren: number, index: number): TreeContext {
  const st = s();
  const saved: TreeContext = { ...st.currentTreeContext };
  const pendingBits = 32 - Math.clz32(totalChildren);
  const slot = index + 1;
  const totalBits = st.currentTreeContext.bits + pendingBits;

  if (totalBits <= 30) {
    st.currentTreeContext = {
      id: (st.currentTreeContext.id << pendingBits) | slot,
      overflow: st.currentTreeContext.overflow,
      bits: totalBits,
    };
  } else {
    let newOverflow = st.currentTreeContext.overflow;
    if (st.currentTreeContext.bits > 0) newOverflow += st.currentTreeContext.id.toString(32);
    st.currentTreeContext = { id: (1 << pendingBits) | slot, overflow: newOverflow, bits: pendingBits };
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

export function snapshotContext(): { tree: TreeContext; localId: number } {
  const st = s();
  return { tree: { ...st.currentTreeContext }, localId: st.localIdCounter };
}

export function restoreContext(snap: { tree: TreeContext; localId: number }) {
  const st = s();
  st.currentTreeContext = { ...snap.tree };
  st.localIdCounter = snap.localId;
}

function getTreeId(): string {
  const { id, overflow, bits } = s().currentTreeContext;
  return bits > 0 ? overflow + id.toString(32) : overflow;
}

export function makeId(): string {
  const st = s();
  const treeId = getTreeId();
  const n = st.localIdCounter++;
  let id = ":" + st.idPrefix + "R";
  if (treeId.length > 0) id += treeId;
  id += ":";
  if (n > 0) id += "H" + n.toString(32) + ":";
  return id;
}
