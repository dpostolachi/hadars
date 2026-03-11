/**
 * Render-time context for tree-position-based `useId` and React Context values.
 *
 * State lives on `globalThis` rather than module-level variables so that
 * multiple slim-react instances (the render worker's direct import and the
 * SSR bundle's bundled copy) share the same singletons without coordination.
 *
 * Context values are stored in an AsyncLocalStorage<Map> so each concurrent
 * SSR request gets its own isolated scope that propagates through all awaits.
 * Call `runWithContextStore` at the start of every render to establish the scope.
 */

// Shared AsyncLocalStorage instance — kept on globalThis so both copies of
// slim-react (direct import + SSR bundle) use the same store.
// The import is done with require() inside a try/catch so that bundlers that
// cannot resolve node:async_hooks (e.g. rspack without target:node set) do
// not fail at build time — the SSR render process always runs in Node.js and
// will find the module at runtime regardless.
const CONTEXT_STORE_KEY = "__slimReactContextStore";
const _g = globalThis as any;
if (!_g[CONTEXT_STORE_KEY]) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AsyncLocalStorage } = require("node:async_hooks") as typeof import("node:async_hooks");
    _g[CONTEXT_STORE_KEY] = new AsyncLocalStorage<Map<object, unknown>>();
  } catch {
    // Fallback: no-op store — context values fall back to _defaultValue.
    // This should never happen in a real SSR environment.
    _g[CONTEXT_STORE_KEY] = null;
  }
}
const _contextStore: { run<T>(store: Map<object,unknown>, fn: () => T): T; getStore(): Map<object,unknown> | undefined } | null = _g[CONTEXT_STORE_KEY];

/** Wrap a render entry-point so it gets its own isolated context-value scope. */
export function runWithContextStore<T>(fn: () => T): T {
  return _contextStore ? _contextStore.run(new Map(), fn) : fn();
}

/**
 * Read the current value for a context within the active render.
 * Falls back to `_defaultValue` (or `_currentValue` for external contexts).
 */
export function getContextValue<T>(context: object): T {
  const store = _contextStore?.getStore();
  if (store && store.has(context)) return store.get(context) as T;
  const c = context as any;
  return ("_defaultValue" in c ? c._defaultValue : c._currentValue) as T;
}

/**
 * Push a new value for a context Provider onto the per-request store.
 * Returns the previous value so the caller can restore it later.
 */
export function pushContextValue(context: object, value: unknown): unknown {
  const store = _contextStore?.getStore();
  const c = context as any;
  const prev = store && store.has(context)
    ? store.get(context)
    : ("_defaultValue" in c ? c._defaultValue : c._currentValue);
  if (store) store.set(context, value);
  return prev;
}

/** Restore a previously saved context value (called by Provider on exit). */
export function popContextValue(context: object, prev: unknown): void {
  const store = _contextStore?.getStore();
  if (store) store.set(context, prev);
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
