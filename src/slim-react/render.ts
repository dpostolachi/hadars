/**
 * Streaming SSR renderer with Suspense support.
 *
 * `renderToStream` walks the virtual-node tree produced by jsx() /
 * createElement() and writes HTML chunks into a ReadableStream.
 *
 * When it meets a <Suspense> boundary it:
 *   1. Tries to render the children into a temporary buffer.
 *   2. If a child throws a Promise (React Suspense protocol) it
 *      awaits the promise, then retries from step 1.
 *   3. Once successful, the buffer is flushed to the real stream.
 *
 * The net effect is that the stream **pauses** at Suspense boundaries
 * until the async data is ready, then continues – exactly as requested.
 */

import {
  SLIM_ELEMENT,
  REACT19_ELEMENT,
  FRAGMENT_TYPE,
  SUSPENSE_TYPE,
  type SlimElement,
  type SlimNode,
} from "./types";
import {
  resetRenderState,
  pushTreeContext,
  popTreeContext,
  pushComponentScope,
  popComponentScope,
  componentCalledUseId,
  snapshotContext,
  restoreContext,
  pushContextValue,
  popContextValue,
  getContextValue,
  swapContextMap,
  captureMap,
  type TreeContext,
} from "./renderContext";
import { installDispatcher, restoreDispatcher } from "./dispatcher";

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#x27;");
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function styleObjectToString(style: Record<string, any>): string {
  return Object.entries(style)
    .map(([key, value]) => {
      // camelCase → kebab-case
      const cssKey = key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      return `${cssKey}:${value}`;
    })
    .join(";");
}

// ---------------------------------------------------------------------------
// SVG attribute name mappings
// ---------------------------------------------------------------------------

/**
 * React camelCase prop → actual SVG attribute.
 * Covers the most commonly used SVG attributes.
 */
const SVG_ATTR_MAP: Record<string, string> = {
  // Presentation / geometry
  accentHeight: "accent-height",
  alignmentBaseline: "alignment-baseline",
  arabicForm: "arabic-form",
  baselineShift: "baseline-shift",
  capHeight: "cap-height",
  clipPath: "clip-path",
  clipRule: "clip-rule",
  colorInterpolation: "color-interpolation",
  colorInterpolationFilters: "color-interpolation-filters",
  colorProfile: "color-profile",
  dominantBaseline: "dominant-baseline",
  enableBackground: "enable-background",
  fillOpacity: "fill-opacity",
  fillRule: "fill-rule",
  floodColor: "flood-color",
  floodOpacity: "flood-opacity",
  fontFamily: "font-family",
  fontSize: "font-size",
  fontSizeAdjust: "font-size-adjust",
  fontStretch: "font-stretch",
  fontStyle: "font-style",
  fontVariant: "font-variant",
  fontWeight: "font-weight",
  glyphName: "glyph-name",
  glyphOrientationHorizontal: "glyph-orientation-horizontal",
  glyphOrientationVertical: "glyph-orientation-vertical",
  horizAdvX: "horiz-adv-x",
  horizOriginX: "horiz-origin-x",
  imageRendering: "image-rendering",
  letterSpacing: "letter-spacing",
  lightingColor: "lighting-color",
  markerEnd: "marker-end",
  markerMid: "marker-mid",
  markerStart: "marker-start",
  overlinePosition: "overline-position",
  overlineThickness: "overline-thickness",
  paintOrder: "paint-order",
  panose1: "panose-1",
  pointerEvents: "pointer-events",
  renderingIntent: "rendering-intent",
  shapeRendering: "shape-rendering",
  stopColor: "stop-color",
  stopOpacity: "stop-opacity",
  strikethroughPosition: "strikethrough-position",
  strikethroughThickness: "strikethrough-thickness",
  strokeDasharray: "stroke-dasharray",
  strokeDashoffset: "stroke-dashoffset",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeMiterlimit: "stroke-miterlimit",
  strokeOpacity: "stroke-opacity",
  strokeWidth: "stroke-width",
  textAnchor: "text-anchor",
  textDecoration: "text-decoration",
  textRendering: "text-rendering",
  underlinePosition: "underline-position",
  underlineThickness: "underline-thickness",
  unicodeBidi: "unicode-bidi",
  unicodeRange: "unicode-range",
  unitsPerEm: "units-per-em",
  vAlphabetic: "v-alphabetic",
  vHanging: "v-hanging",
  vIdeographic: "v-ideographic",
  vMathematical: "v-mathematical",
  vertAdvY: "vert-adv-y",
  vertOriginX: "vert-origin-x",
  vertOriginY: "vert-origin-y",
  wordSpacing: "word-spacing",
  writingMode: "writing-mode",
  xHeight: "x-height",

  // Namespace-prefixed
  xlinkActuate: "xlink:actuate",
  xlinkArcrole: "xlink:arcrole",
  xlinkHref: "xlink:href",
  xlinkRole: "xlink:role",
  xlinkShow: "xlink:show",
  xlinkTitle: "xlink:title",
  xlinkType: "xlink:type",
  xmlBase: "xml:base",
  xmlLang: "xml:lang",
  xmlSpace: "xml:space",
  xmlns: "xmlns",
  xmlnsXlink: "xmlns:xlink",

  // Filter / lighting
  baseFrequency: "baseFrequency",
  colorInterpolation_filters: "color-interpolation-filters",
  diffuseConstant: "diffuseConstant",
  edgeMode: "edgeMode",
  filterUnits: "filterUnits",
  gradientTransform: "gradientTransform",
  gradientUnits: "gradientUnits",
  kernelMatrix: "kernelMatrix",
  kernelUnitLength: "kernelUnitLength",
  lengthAdjust: "lengthAdjust",
  limitingConeAngle: "limitingConeAngle",
  markerHeight: "markerHeight",
  markerWidth: "markerWidth",
  maskContentUnits: "maskContentUnits",
  maskUnits: "maskUnits",
  numOctaves: "numOctaves",
  pathLength: "pathLength",
  patternContentUnits: "patternContentUnits",
  patternTransform: "patternTransform",
  patternUnits: "patternUnits",
  pointsAtX: "pointsAtX",
  pointsAtY: "pointsAtY",
  pointsAtZ: "pointsAtZ",
  preserveAspectRatio: "preserveAspectRatio",
  primitiveUnits: "primitiveUnits",
  refX: "refX",
  refY: "refY",
  repeatCount: "repeatCount",
  repeatDur: "repeatDur",
  specularConstant: "specularConstant",
  specularExponent: "specularExponent",
  spreadMethod: "spreadMethod",
  startOffset: "startOffset",
  stdDeviation: "stdDeviation",
  stitchTiles: "stitchTiles",
  surfaceScale: "surfaceScale",
  systemLanguage: "systemLanguage",
  tableValues: "tableValues",
  targetX: "targetX",
  targetY: "targetY",
  textLength: "textLength",
  viewBox: "viewBox",
  xChannelSelector: "xChannelSelector",
  yChannelSelector: "yChannelSelector",
};

/** Set of known SVG element tag names. */
const SVG_ELEMENTS = new Set([
  "svg", "animate", "animateMotion", "animateTransform", "circle",
  "clipPath", "defs", "desc", "ellipse", "feBlend", "feColorMatrix",
  "feComponentTransfer", "feComposite", "feConvolveMatrix",
  "feDiffuseLighting", "feDisplacementMap", "feDistantLight",
  "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG",
  "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode",
  "feMorphology", "feOffset", "fePointLight", "feSpecularLighting",
  "feSpotLight", "feTile", "feTurbulence", "filter", "foreignObject",
  "g", "image", "line", "linearGradient", "marker", "mask",
  "metadata", "mpath", "path", "pattern", "polygon", "polyline",
  "radialGradient", "rect", "set", "stop", "switch", "symbol",
  "text", "textPath", "title", "tspan", "use", "view",
]);

function renderAttributes(props: Record<string, any>, isSvg: boolean): string {
  let attrs = "";
  for (const [key, value] of Object.entries(props)) {
    // Skip internal / non-attribute props
    if (
      key === "children" ||
      key === "key" ||
      key === "ref" ||
      key === "dangerouslySetInnerHTML" ||
      key === "suppressHydrationWarning" ||
      key === "suppressContentEditableWarning"
    )
      continue;
    // Skip event handlers (onClick, onChange, …)
    if (key.startsWith("on") && key.length > 2 && key[2] === key[2]!.toUpperCase())
      continue;

    // Prop-name mapping
    let attrName: string;
    if (isSvg && key in SVG_ATTR_MAP) {
      attrName = SVG_ATTR_MAP[key]!;
    } else {
      attrName =
        key === "className"
          ? "class"
          : key === "htmlFor"
            ? "for"
            : key === "tabIndex"
              ? "tabindex"
              : key === "defaultValue"
                ? "value"
                : key === "defaultChecked"
                  ? "checked"
                  : key;
    }

    if (value === false || value == null) {
      // aria-* and data-* attributes treat `false` as the string "false"
      // (omitting them would change semantics, e.g. aria-hidden="false" ≠ absent).
      if (value === false && (attrName.startsWith("aria-") || attrName.startsWith("data-"))) {
        attrs += ` ${attrName}="false"`;
      }
      continue;
    }
    if (value === true) {
      // aria-* and data-* are string attributes: true must serialize to "true".
      // HTML boolean attributes (disabled, hidden, checked, …) use attr="" (present-without-value).
      if (attrName.startsWith("aria-") || attrName.startsWith("data-")) {
        attrs += ` ${attrName}="true"`;
      } else {
        attrs += ` ${attrName}=""`;
      }
      continue;
    }
    if (key === "style" && typeof value === "object") {
      const styleStr = styleObjectToString(value);
      if (styleStr) attrs += ` style="${escapeAttr(styleStr)}"`;
      continue;
    }
    attrs += ` ${attrName}="${escapeAttr(String(value))}"`;
  }
  return attrs;
}

// ---------------------------------------------------------------------------
// Writer abstraction (stream vs buffer)
// ---------------------------------------------------------------------------

interface Writer {
  /** Write raw HTML markup. Resets lastWasText to false. */
  write(chunk: string): void;
  /** Write escaped text content. Sets lastWasText to true. */
  text(s: string): void;
  /** True if the last thing written was a text node (not markup). */
  lastWasText: boolean;
}

class BufferWriter implements Writer {
  chunks: string[] = [];
  lastWasText = false;
  write(chunk: string) {
    this.chunks.push(chunk);
    this.lastWasText = false;
  }
  text(s: string) {
    this.chunks.push(s);
    this.lastWasText = true;
  }
  flush(target: Writer) {
    for (const c of this.chunks) target.write(c);
    // Propagate the text-node tracking state from the buffer's last write.
    target.lastWasText = this.lastWasText;
  }
}

// ---------------------------------------------------------------------------
// Core recursive renderer  (sync-first design)
//
// `renderNode` is synchronous for the fast path (plain HTML elements,
// text, fragments, pure function components).  It only returns a
// Promise when something actually async happens (Suspense throw,
// async component).  This eliminates thousands of unnecessary
// microtask bounces for a typical component tree.
// ---------------------------------------------------------------------------

type MaybePromise = void | Promise<void>;

function renderNode(
  node: SlimNode,
  writer: Writer,
  isSvg = false,
): MaybePromise {
  // --- primitives / nullish ---
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string") {
    writer.text(escapeHtml(node));
    return;
  }
  if (typeof node === "number") {
    writer.text(String(node));
    return;
  }

  // --- arrays ---
  if (Array.isArray(node)) {
    return renderChildArray(node, writer, isSvg);
  }

  // --- iterables (Set, generator, …) ---
  if (
    typeof node === "object" &&
    node !== null &&
    Symbol.iterator in node &&
    !("$$typeof" in node)
  ) {
    return renderChildArray(
      Array.from(node as Iterable<SlimNode>),
      writer,
      isSvg,
    );
  }

  // --- SlimElement (accepts both the classic and React 19 transitional symbols) ---
  if (
    typeof node === "object" &&
    node !== null &&
    "$$typeof" in node
  ) {
    const elType = (node as any)["$$typeof"] as symbol;
    if (elType !== SLIM_ELEMENT && elType !== REACT19_ELEMENT) return;
    const element = node as SlimElement;
    const { type, props } = element;

    // Fragment
    if (type === FRAGMENT_TYPE) {
      return renderChildren(props.children, writer, isSvg);
    }

    // Suspense – always async
    if (type === SUSPENSE_TYPE) {
      return renderSuspense(props, writer, isSvg);
    }

    // Function / class component
    if (typeof type === "function") {
      return renderComponent(type, props, writer, isSvg);
    }

    // Object component wrappers: React.memo, React.forwardRef,
    // Context.Provider (React 19: the context IS the provider),
    // Context.Consumer — all identified by their own $$typeof.
    if (typeof type === "object" && type !== null) {
      return renderComponent(type as unknown as Function, props, writer, isSvg);
    }

    // HTML / SVG element
    if (typeof type === "string") {
      return renderHostElement(type, props, writer, isSvg);
    }
  }
}

/**
 * Recursively clone `<option>` / `<optgroup>` nodes inside a `<select>` tree,
 * stamping `selected` on options whose value is in `selectedValues`.
 * Handles both single-select and multi-select (defaultValue array).
 */
function markSelectedOptionsMulti(children: SlimNode, selectedValues: Set<string>): SlimNode {
  if (children == null || typeof children === "boolean") return children;
  if (typeof children === "string" || typeof children === "number") return children;
  if (Array.isArray(children)) {
    return children.map((c) => markSelectedOptionsMulti(c, selectedValues));
  }
  if (
    typeof children === "object" &&
    "$$typeof" in children
  ) {
    const elType = (children as any)["$$typeof"] as symbol;
    if (elType !== SLIM_ELEMENT && elType !== REACT19_ELEMENT) return children;
    const el = children as SlimElement;
    if (el.type === "option") {
      // Option value falls back to its text children if no value prop.
      const optValue = el.props.value !== undefined ? el.props.value : el.props.children;
      const isSelected = selectedValues.has(String(optValue));
      return { ...el, props: { ...el.props, selected: isSelected || undefined } };
    }
    if (el.type === "optgroup" || el.type === FRAGMENT_TYPE) {
      const newChildren = markSelectedOptionsMulti(el.props.children, selectedValues);
      return { ...el, props: { ...el.props, children: newChildren } };
    }
  }
  return children;
}

/** Render a host (HTML/SVG) element. Sync when children are sync. */
function renderHostElement(
  tag: string,
  props: Record<string, any>,
  writer: Writer,
  isSvg: boolean,
): MaybePromise {
  const enteringSvg = tag === "svg";
  const childSvg = isSvg || enteringSvg;

  // ── <textarea> ────────────────────────────────────────────────────────────
  if (tag === "textarea") {
    const textContent = props.value ?? props.defaultValue ?? props.children ?? "";
    const filteredProps: Record<string, any> = {};
    for (const k of Object.keys(props)) {
      if (k !== "value" && k !== "defaultValue" && k !== "children") filteredProps[k] = props[k];
    }
    writer.write(`<textarea${renderAttributes(filteredProps, false)}>`);
    writer.text(escapeHtml(String(textContent)));
    writer.write("</textarea>");
    return;
  }

  // ── <select> ──────────────────────────────────────────────────────────────
  // React never emits a `value` attribute on <select>; instead it marks the
  // matching <option> as `selected`.
  if (tag === "select") {
    const selectedValue = props.value ?? props.defaultValue;
    const filteredProps: Record<string, any> = {};
    for (const k of Object.keys(props)) {
      if (k !== "value" && k !== "defaultValue") filteredProps[k] = props[k];
    }
    writer.write(`<select${renderAttributes(filteredProps, false)}>`);
    // Normalise selectedValue to a Set of strings to handle both single values
    // and arrays (multi-select with defaultValue={['a','b']}).
    const selectedSet: Set<string> | null =
      selectedValue == null
        ? null
        : Array.isArray(selectedValue)
          ? new Set((selectedValue as unknown[]).map(String))
          : new Set([String(selectedValue)]);
    const patchedChildren =
      selectedSet != null
        ? markSelectedOptionsMulti(props.children, selectedSet)
        : props.children;
    const inner = renderChildren(patchedChildren, writer, false);
    if (inner && typeof (inner as any).then === "function") {
      return (inner as Promise<void>).then(() => { writer.write("</select>"); });
    }
    writer.write("</select>");
    return;
  }

  // React 19 does not inject xmlns on <svg> — browsers handle SVG namespaces
  // automatically for inline HTML5 SVG, so we match React's behaviour.
  writer.write(`<${tag}${renderAttributes(props, childSvg)}`);

  // Void elements are self-closing (matching React's output format).
  if (VOID_ELEMENTS.has(tag)) {
    writer.write("/>");
    return;
  }

  writer.write(">");
  const childContext = tag === "foreignObject" ? false : childSvg;

  let inner: MaybePromise = undefined;
  if (props.dangerouslySetInnerHTML) {
    writer.write(props.dangerouslySetInnerHTML.__html);
  } else {
    inner = renderChildren(props.children, writer, childContext);
  }

  if (inner && typeof (inner as any).then === "function") {
    return (inner as Promise<void>).then(() => { writer.write(`</${tag}>`); });
  }
  writer.write(`</${tag}>`);
}

// React special $$typeof symbols for memo, forwardRef, context/provider/consumer, lazy
const REACT_MEMO        = Symbol.for("react.memo");
const REACT_FORWARD_REF = Symbol.for("react.forward_ref");
const REACT_PROVIDER    = Symbol.for("react.provider");  // React 18 Provider object
const REACT_CONTEXT     = Symbol.for("react.context");   // React 19: context IS provider
const REACT_CONSUMER    = Symbol.for("react.consumer");  // React 19 Consumer object
const REACT_LAZY        = Symbol.for("react.lazy");      // React.lazy()

/** Render a function or class component. */
function renderComponent(
  type: Function,
  props: Record<string, any>,
  writer: Writer,
  isSvg: boolean,
): MaybePromise {
  const typeOf = (type as any)?.$$typeof;

  // React.memo — unwrap and re-render the inner type
  if (typeOf === REACT_MEMO) {
    return renderNode(
      { $$typeof: SLIM_ELEMENT, type: (type as any).type, props, key: null } as any,
      writer, isSvg,
    );
  }

  // React.forwardRef — call the wrapped render function
  if (typeOf === REACT_FORWARD_REF) {
    return renderComponent((type as any).render, props, writer, isSvg);
  }

  // React.lazy — initialise via the _init/_payload protocol; may suspend.
  if (typeOf === REACT_LAZY) {
    // _init returns the resolved module (or throws a Promise/Error).
    const resolved = (type as any)._init((type as any)._payload);
    // The module may export `.default` or be the component directly.
    const LazyComp = resolved?.default ?? resolved;
    return renderComponent(LazyComp, props, writer, isSvg);
  }

  // React.Consumer (React 19) — call the children render prop with the current value
  if (typeOf === REACT_CONSUMER) {
    const ctx = (type as any)._context;
    const value = ctx ? getContextValue(ctx) : undefined;
    const result: SlimNode =
      typeof props.children === "function" ? props.children(value) : null;
    const savedScope = pushComponentScope();
    const finish = () => popComponentScope(savedScope);
    const r = renderNode(result, writer, isSvg);
    if (r && typeof (r as any).then === "function") {
      return (r as Promise<void>).then(finish);
    }
    finish();
    return;
  }

  // Provider detection:
  //   slim-react:   Provider function has `_context` property
  //   React 18:     Provider object has $$typeof === react.provider and ._context
  //   React 19:     Context object itself is the provider ($$typeof === react.context + value prop)
  const isProvider =
    "_context" in type ||
    typeOf === REACT_PROVIDER ||
    (typeOf === REACT_CONTEXT && "value" in props);

  let prevCtxValue: any;
  let ctx: any;

  if (isProvider) {
    // Resolve the actual context object from any provider variant
    ctx = (type as any)._context ?? type;
    prevCtxValue = pushContextValue(ctx, props.value);
  }

  // Each component gets a fresh local-ID counter (for multiple useId calls).
  const savedScope = pushComponentScope();

  // For React 19 Provider (context object IS the provider — not callable), just
  // render children directly; the context value was already pushed above.
  if (isProvider && typeof type !== "function") {
    const finish = () => {
      popComponentScope(savedScope);
      popContextValue(ctx, prevCtxValue);
    };
    const r = renderChildren(props.children, writer, isSvg);
    if (r && typeof (r as any).then === "function") {
      const m = captureMap();
      return (r as Promise<void>).then(
        () => { swapContextMap(m); finish(); },
        (e) => { swapContextMap(m); finish(); throw e; },
      );
    }
    finish();
    return;
  }

  let result: SlimNode;
  const prevDispatcher = installDispatcher();
  try {
    if (type.prototype && typeof type.prototype.render === "function") {
      const instance = new (type as any)(props);
      // Call getDerivedStateFromProps if defined, matching React's behaviour.
      if (typeof (type as any).getDerivedStateFromProps === "function") {
        const derived = (type as any).getDerivedStateFromProps(props, instance.state ?? {});
        if (derived != null) instance.state = { ...(instance.state ?? {}), ...derived };
      }
      result = instance.render();
    } else {
      result = type(props);
    }
  } catch (e) {
    restoreDispatcher(prevDispatcher);
    popComponentScope(savedScope);
    if (isProvider) popContextValue(ctx, prevCtxValue);
    throw e;
  }
  restoreDispatcher(prevDispatcher);

  // React 19 finishFunctionComponent: if the component called useId, push a
  // tree-context slot for the component's OUTPUT children — matching React 19's
  // `pushTreeContext(keyPath, 1, 0)` call inside finishFunctionComponent.
  // This ensures that useId IDs produced by child components of a useId-calling
  // component are tree-positioned identically to React's own renderer.
  let savedIdTree: TreeContext | undefined;
  if (!(result instanceof Promise) && componentCalledUseId()) {
    savedIdTree = pushTreeContext(1, 0);
  }

  const finish = () => {
    if (savedIdTree !== undefined) popTreeContext(savedIdTree);
    popComponentScope(savedScope);
    if (isProvider) popContextValue(ctx, prevCtxValue);
  };

  // Async component
  if (result instanceof Promise) {
    const m = captureMap();
    return result.then((resolved) => {
      swapContextMap(m);
      // Check useId after the async body has finished executing.
      let asyncSavedIdTree: TreeContext | undefined;
      if (componentCalledUseId()) {
        asyncSavedIdTree = pushTreeContext(1, 0);
      }
      const asyncFinish = () => {
        if (asyncSavedIdTree !== undefined) popTreeContext(asyncSavedIdTree);
        popComponentScope(savedScope);
        if (isProvider) popContextValue(ctx, prevCtxValue);
      };
      const r = renderNode(resolved, writer, isSvg);
      if (r && typeof (r as any).then === "function") {
        const m2 = captureMap();
        return (r as Promise<void>).then(
          () => { swapContextMap(m2); asyncFinish(); },
          (e) => { swapContextMap(m2); asyncFinish(); throw e; },
        );
      }
      asyncFinish();
    }, (e) => { swapContextMap(m); finish(); throw e; });
  }

  const r = renderNode(result, writer, isSvg);

  if (r && typeof (r as any).then === "function") {
    const m = captureMap();
    return (r as Promise<void>).then(
      () => { swapContextMap(m); finish(); },
      (e) => { swapContextMap(m); finish(); throw e; },
    );
  }
  finish();
}

/**
 * Render an array of children, pushing tree-context for each child
 * so that `useId` produces deterministic, position-based IDs.
 * Goes async only when a child actually returns a Promise.
 */
/** Returns true for nodes that become DOM text nodes (string or number). */
function isTextLike(node: SlimNode): boolean {
  return typeof node === "string" || typeof node === "number";
}

function renderChildArray(
  children: SlimNode[],
  writer: Writer,
  isSvg: boolean,
): MaybePromise {
  const totalChildren = children.length;
  for (let i = 0; i < totalChildren; i++) {
    // React inserts <!-- --> between adjacent text nodes to force the browser
    // to preserve distinct DOM text nodes — required for correct hydration.
    // We use writer.lastWasText instead of inspecting the previous VDOM node
    // so that text emitted at the end of a nested array or fragment is also
    // accounted for (fixes the {["a","b"]}{"c"} adjacency edge case).
    if (isTextLike(children[i]) && writer.lastWasText) {
      writer.write("<!-- -->");
    }
    const savedTree = pushTreeContext(totalChildren, i);
    const r = renderNode(children[i], writer, isSvg);
    if (r && typeof (r as any).then === "function") {
      // One child went async – continue the rest asynchronously
      const m = captureMap();
      return (r as Promise<void>).then(() => {
        swapContextMap(m);
        popTreeContext(savedTree);
        // Continue with remaining children
        return renderChildArrayFrom(children, i + 1, writer, isSvg);
      });
    }
    popTreeContext(savedTree);
  }
}

/** Resume renderChildArray from a given index (after async child). */
function renderChildArrayFrom(
  children: SlimNode[],
  startIndex: number,
  writer: Writer,
  isSvg: boolean,
): MaybePromise {
  const totalChildren = children.length;
  for (let i = startIndex; i < totalChildren; i++) {
    if (isTextLike(children[i]) && writer.lastWasText) {
      writer.write("<!-- -->");
    }
    const savedTree = pushTreeContext(totalChildren, i);
    const r = renderNode(children[i], writer, isSvg);
    if (r && typeof (r as any).then === "function") {
      const m = captureMap();
      return (r as Promise<void>).then(() => {
        swapContextMap(m);
        popTreeContext(savedTree);
        return renderChildArrayFrom(children, i + 1, writer, isSvg);
      });
    }
    popTreeContext(savedTree);
  }
}

function renderChildren(
  children: SlimNode,
  writer: Writer,
  isSvg = false,
): MaybePromise {
  if (children == null) return;
  if (Array.isArray(children)) {
    return renderChildArray(children, writer, isSvg);
  }
  return renderNode(children, writer, isSvg);
}

// ---------------------------------------------------------------------------
// Suspense boundary renderer
//
// Sibling Suspense boundaries within the same parent are resolved
// **in parallel**: we kick off all of them concurrently and stream
// their results in document order once each resolves.
// ---------------------------------------------------------------------------

const MAX_SUSPENSE_RETRIES = 25;

async function renderSuspense(
  props: Record<string, any>,
  writer: Writer,
  isSvg = false,
): Promise<void> {
  const { children, fallback } = props;
  let attempts = 0;

  // Snapshot the render context so we can reset between retries.
  const snap = snapshotContext();

  while (attempts < MAX_SUSPENSE_RETRIES) {
    // Restore context to the state it was in when we entered <Suspense>.
    restoreContext(snap);
    let buffer = new BufferWriter();
    try {
      const r = renderNode(children, buffer, isSvg);
      if (r && typeof (r as any).then === "function") {
        const m = captureMap(); await r; swapContextMap(m);
      }
      // Success – wrap with React's Suspense boundary markers so hydrateRoot
      // can locate the boundary in the DOM (<!--$--> … <!--/$-->).
      writer.write("<!--$-->");
      buffer.flush(writer);
      writer.write("<!--/$-->");
      return;
    } catch (error: unknown) {
      if (error && typeof (error as any).then === "function") {
        const m = captureMap(); await (error as Promise<unknown>); swapContextMap(m);
        attempts++;
      } else {
        throw error;
      }
    }
  }

  // Exhausted retries → render the fallback (boundary stays in loading state).
  restoreContext(snap);
  writer.write("<!--$?-->");
  if (fallback) {
    const r = renderNode(fallback, writer, isSvg);
    if (r && typeof (r as any).then === "function") {
      const m = captureMap(); await r; swapContextMap(m);
    }
  }
  writer.write("<!--/$-->");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RenderOptions {
  /**
   * Must match the `identifierPrefix` option passed to `hydrateRoot` on the
   * client so that `useId()` generates identical IDs on server and client.
   * Defaults to `""` (React's default).
   */
  identifierPrefix?: string;
}

/**
 * Render a component tree to a `ReadableStream<Uint8Array>`.
 *
 * The stream pauses at `<Suspense>` boundaries until the suspended
 * promise resolves, then continues writing HTML.
 */
export function renderToStream(
  element: SlimNode,
  options?: RenderOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const idPrefix = options?.identifierPrefix ?? "";

  const contextMap = new Map<object, unknown>();
  return new ReadableStream({
    async start(controller) {
      resetRenderState(idPrefix);
      const prev = swapContextMap(contextMap);

      const writer: Writer = {
        lastWasText: false,
        write(chunk: string) {
          controller.enqueue(encoder.encode(chunk));
          this.lastWasText = false;
        },
        text(s: string) {
          controller.enqueue(encoder.encode(s));
          this.lastWasText = true;
        },
      };

      try {
        const r = renderNode(element, writer);
        if (r && typeof (r as any).then === "function") {
          const m = captureMap(); await r; swapContextMap(m);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        swapContextMap(prev);
      }
    },
  });
}

/**
 * Convenience: render to a complete HTML string.
 * Retries the full tree when a component throws a Promise (Suspense protocol),
 * so useServerData and similar hooks work without requiring explicit <Suspense>.
 */
export async function renderToString(
  element: SlimNode,
  options?: RenderOptions,
): Promise<string> {
  const idPrefix = options?.identifierPrefix ?? "";
  const contextMap = new Map<object, unknown>();
  const prev = swapContextMap(contextMap);
  try {
    for (let attempt = 0; attempt < MAX_SUSPENSE_RETRIES; attempt++) {
      resetRenderState(idPrefix);
      swapContextMap(contextMap); // re-activate our map on each retry
      const chunks: string[] = [];
      const writer: Writer = {
        lastWasText: false,
        write(c) { chunks.push(c); this.lastWasText = false; },
        text(s) { chunks.push(s); this.lastWasText = true; },
      };
      try {
        const r = renderNode(element, writer);
        if (r && typeof (r as any).then === "function") {
          const m = captureMap(); await r; swapContextMap(m);
        }
        return chunks.join("");
      } catch (error) {
        if (error && typeof (error as any).then === "function") {
          const m = captureMap(); await (error as Promise<unknown>); swapContextMap(m);
          continue;
        }
        throw error;
      }
    }
    throw new Error("[slim-react] renderToString exceeded maximum retries");
  } finally {
    swapContextMap(prev);
  }
}

/** Alias matching React 18+ server API naming. */
export { renderToStream as renderToReadableStream };
