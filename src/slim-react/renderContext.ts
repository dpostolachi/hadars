/**
 * Render-time context for tree-position-based `useId`.
 *
 * State lives on `globalThis` rather than module-level variables so that
 * multiple slim-react instances (the render worker's direct import and the
 * SSR bundle's bundled copy) share the same context without any coordination.
 * Safe because each worker processes one render at a time; `resetRenderState`
 * is always called at the top of every `renderToString` / `renderToStream`.
 */

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
