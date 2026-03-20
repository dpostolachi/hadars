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
  captureUnsuspend,
  restoreUnsuspend,
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

const HTML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#x27;' };
const HTML_ESC_RE = /[&<>']/;
function escapeHtml(str: string): string {
  // Fast path: avoid regex replace + callback allocation when there's nothing to escape.
  if (!HTML_ESC_RE.test(str)) return str;
  return str.replace(/[&<>']/g, c => HTML_ESC[c]!);
}

const ATTR_ESC: Record<string, string> = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' };
const ATTR_ESC_RE = /[&"<>]/;
function escapeAttr(str: string): string {
  if (!ATTR_ESC_RE.test(str)) return str;
  return str.replace(/[&"<>]/g, c => ATTR_ESC[c]!);
}

/**
 * CSS properties that accept plain numbers without a `px` suffix.
 * Matches React's internal unitless-number list so SSR output agrees with
 * client-side React during hydration.
 */
const UNITLESS_CSS = new Set([
  'animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice',
  'borderImageWidth', 'boxFlex', 'boxFlexGroup', 'boxOrdinalGroup', 'columnCount',
  'columns', 'flex', 'flexGrow', 'flexPositive', 'flexShrink', 'flexNegative',
  'flexOrder', 'gridArea', 'gridRow', 'gridRowEnd', 'gridRowSpan', 'gridRowStart',
  'gridColumn', 'gridColumnEnd', 'gridColumnSpan', 'gridColumnStart', 'fontWeight',
  'lineClamp', 'lineHeight', 'opacity', 'order', 'orphans', 'scale', 'tabSize',
  'widows', 'zIndex', 'zoom', 'fillOpacity', 'floodOpacity', 'stopOpacity',
  'strokeDasharray', 'strokeDashoffset', 'strokeMiterlimit', 'strokeOpacity',
  'strokeWidth',
]);

/** Intern camelCase → kebab-case CSS property name conversions. */
const _cssKeyCache = new Map<string, string>();
function styleObjectToString(style: Record<string, any>): string {
  let result = '';
  for (const key in style) {
    const value = style[key];
    // Skip null, undefined and boolean values (React behaviour).
    if (value == null || typeof value === 'boolean') continue;
    if (result) result += ';';
    // camelCase → kebab-case, cached to avoid repeated regex per render.
    let cssKey = _cssKeyCache.get(key);
    if (cssKey === undefined) {
      cssKey = key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      _cssKeyCache.set(key, cssKey);
    }
    // Append 'px' for numeric values on non-unitless properties (React behaviour).
    if (typeof value === 'number' && value !== 0 && !UNITLESS_CSS.has(key)) {
      result += cssKey + ':' + value + 'px';
    } else {
      result += cssKey + ':' + value;
    }
  }
  return result;
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

// Pre-allocated skip-sets for special host elements that strip certain props
// before delegating to writeAttributes.  Module-level so they are created once.
const TEXTAREA_SKIP_PROPS = new Set(["value", "defaultValue", "children"]);
const SELECT_SKIP_PROPS   = new Set(["value", "defaultValue"]);

// Internal React props that must never be serialised as HTML attributes.
// A Set lookup (one hash probe) replaces six sequential string comparisons
// for every attribute on every element — the hottest path in the renderer.
const INTERNAL_PROPS = new Set([
  "children", "key", "ref",
  "dangerouslySetInnerHTML",
  "suppressHydrationWarning",
  "suppressContentEditableWarning",
]);

/**
 * Write element attributes directly into the writer, skipping the
 * intermediate `attrs` string that `renderAttributes` used to return.
 * Eliminates one heap string allocation per element.
 *
 * @param skip - Optional set of prop names to exclude (used by textarea/select).
 */
function writeAttributes(writer: Writer, props: Record<string, any>, isSvg: boolean, skip?: ReadonlySet<string>): void {
  for (const key in props) {
    if (skip !== undefined && skip.has(key)) continue;
    const value = props[key];
    // Skip internal / non-attribute props — one hash probe replaces 6 comparisons.
    if (INTERNAL_PROPS.has(key)) continue;
    // Skip event handlers (onClick, onChange, …) — use charCodeAt for speed.
    if (
      key.length > 2 &&
      key.charCodeAt(0) === 111 /*o*/ &&
      key.charCodeAt(1) === 110 /*n*/ &&
      key.charCodeAt(2) >= 65 && key.charCodeAt(2) <= 90 /*A-Z*/
    ) continue;

    // Prop-name mapping
    let attrName: string;
    if (isSvg && key in SVG_ATTR_MAP) {
      attrName = SVG_ATTR_MAP[key]!;
    } else {
      attrName =
        key === "className"    ? "class"
        : key === "htmlFor"    ? "for"
        : key === "tabIndex"   ? "tabindex"
        : key === "defaultValue"   ? "value"
        : key === "defaultChecked" ? "checked"
        : key;
    }

    if (value === false || value == null) {
      if (value === false && (attrName.charCodeAt(0) === 97 /*a*/ && attrName.startsWith("aria-") ||
                              attrName.charCodeAt(0) === 100 /*d*/ && attrName.startsWith("data-"))) {
        writer.write(` ${attrName}="false"`);
      }
      continue;
    }
    if (value === true) {
      if (attrName.charCodeAt(0) === 97 /*a*/ && attrName.startsWith("aria-") ||
          attrName.charCodeAt(0) === 100 /*d*/ && attrName.startsWith("data-")) {
        writer.write(` ${attrName}="true"`);
      } else {
        writer.write(` ${attrName}=""`);
      }
      continue;
    }
    if (key === "style" && typeof value === "object") {
      const styleStr = styleObjectToString(value);
      if (styleStr) writer.write(` style="${escapeAttr(styleStr)}"`);
      continue;
    }
    writer.write(` ${attrName}="${escapeAttr(typeof value === 'string' ? value : String(value))}"`); 
  }
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
  /**
   * Optional: encode and flush any internal string buffer downstream.
   * Called at natural streaming boundaries (Suspense completions, end of render).
   * Writers that don't buffer (e.g. BufferWriter, NullWriter) leave this undefined.
   */
  flush?(): void;
}

class BufferWriter implements Writer {
  data = "";
  lastWasText = false;
  write(chunk: string) {
    this.data += chunk;
    this.lastWasText = false;
  }
  text(s: string) {
    this.data += s;
    this.lastWasText = true;
  }
  /** Flush accumulated output into a parent writer and reset. */
  flushTo(target: Writer) {
    if (!this.data) return; // nothing buffered — preserve target's lastWasText
    // Single write call — the entire buffered string in one shot.
    if (target instanceof BufferWriter) {
      target.data += this.data;
    } else {
      target.write(this.data);
    }
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

  // At this point node is guaranteed to be a non-null object — null/boolean/
  // string/number/Array are all handled above.  The iterable and $$typeof
  // branches no longer need to re-test typeof/null.
  const obj = node as any;

  // --- iterables (Set, generator, …) ---
  if (Symbol.iterator in obj && !("$$typeof" in obj)) {
    return renderChildArray(Array.from(obj as Iterable<SlimNode>), writer, isSvg);
  }

  // --- SlimElement (accepts both the classic and React 19 transitional symbols) ---
  if ("$$typeof" in obj) {
    const elType = obj["$$typeof"] as symbol;
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

    // HTML / SVG element — most common; check string before function to
    // hit the branch earlier for the majority of nodes.
    if (typeof type === "string") {
      return renderHostElement(type, props, writer, isSvg);
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
  const childSvg = isSvg || tag === "svg";

  // ── <textarea> ────────────────────────────────────────────────────────────
  if (tag === "textarea") {
    const textContent = props.value ?? props.defaultValue ?? props.children ?? "";
    writer.write("<textarea");
    writeAttributes(writer, props, false, TEXTAREA_SKIP_PROPS);
    writer.write(">");
    writer.text(escapeHtml(String(textContent)));
    writer.write("</textarea>");
    return;
  }

  // ── <select> ──────────────────────────────────────────────────────────────
  // React never emits a `value` attribute on <select>; instead it marks the
  // matching <option> as `selected`.
  if (tag === "select") {
    const selectedValue = props.value ?? props.defaultValue;
    writer.write("<select");
    writeAttributes(writer, props, false, SELECT_SKIP_PROPS);
    writer.write(">");
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
  writer.write(`<${tag}`);
  writeAttributes(writer, props, childSvg);

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

// Sentinel thrown by renderComponent when a component exceeds its per-boundary
// suspension retry limit. Caught by renderSuspense to trigger fallback rendering.
// Using a unique object (not a subclass) keeps the check a fast reference equality.
const SUSPENSE_RETRY_LIMIT: unique symbol = Symbol("SuspenseRetryLimit");
const MAX_COMPONENT_SUSPENSE_RETRIES = 25;

/** React 19 `use()` protocol — patch a thrown promise with status tracking so
 *  that `use(promise)` can return the resolved value synchronously on retry. */
function patchPromiseStatus(p: Promise<unknown>): void {
  const w = p as Promise<unknown> & { status?: string; value?: unknown; reason?: unknown };
  if (w.status) return; // already tracked (e.g. React.lazy payload)
  w.status = "pending";
  w.then(
    (v) => { w.status = "fulfilled"; w.value = v; },
    (r) => { w.status = "rejected"; w.reason = r; },
  );
}

/** Render a function or class component. */
function renderComponent(
  type: Function,
  props: Record<string, any>,
  writer: Writer,
  isSvg: boolean,
  _suspenseRetries = 0,
): MaybePromise {
  // type is always a defined Function — the optional chain is never needed.
  const typeOf = (type as any).$$typeof;

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
    let resolved: any;
    try {
      resolved = (type as any)._init((type as any)._payload);
    } catch (e) {
      // Module not yet loaded — treat as a component-level suspension.
      if (e && typeof (e as any).then === "function") {
        if (_suspenseRetries + 1 >= MAX_COMPONENT_SUSPENSE_RETRIES) throw SUSPENSE_RETRY_LIMIT;
        patchPromiseStatus(e as Promise<unknown>);
        const m = captureMap(); const u = captureUnsuspend();
        return (e as Promise<unknown>).then(() => {
          swapContextMap(m); restoreUnsuspend(u);
          return renderComponent(type, props, writer, isSvg, _suspenseRetries + 1);
        });
      }
      throw e;
    }
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
      const m = captureMap(); const u = captureUnsuspend();
      return (r as Promise<void>).then(
        () => { swapContextMap(m); restoreUnsuspend(u); finish(); },
        (e) => { swapContextMap(m); restoreUnsuspend(u); finish(); throw e; },
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
    // Suspense protocol: the component threw a Promise (e.g. useServerData without
    // a <Suspense> wrapper). Context is fully restored at this point — dispatcher,
    // component scope and context value are all popped back to pre-component state.
    // Convert the throw into a returned Promise so the parent never sees a throw and
    // no root restart is needed: we await the promise then retry ONLY this component.
    if (e && typeof (e as any).then === "function") {
      if (_suspenseRetries + 1 >= MAX_COMPONENT_SUSPENSE_RETRIES) throw SUSPENSE_RETRY_LIMIT;
      patchPromiseStatus(e as Promise<unknown>);
      const m = captureMap(); const u = captureUnsuspend();
      return (e as Promise<unknown>).then(() => {
        swapContextMap(m); restoreUnsuspend(u);
        return renderComponent(type, props, writer, isSvg, _suspenseRetries + 1);
      });
    }
    throw e;
  }
  restoreDispatcher(prevDispatcher);

  // React 19 finishFunctionComponent: if the component called useId, push a
  // tree-context slot for the component's OUTPUT children — matching React 19's
  // `pushTreeContext(keyPath, 1, 0)` call inside finishFunctionComponent.
  // This ensures that useId IDs produced by child components of a useId-calling
  // component are tree-positioned identically to React's own renderer.
  let savedIdTree: number | undefined;
  if (!(result instanceof Promise) && componentCalledUseId()) {
    savedIdTree = pushTreeContext(1, 0);
  }

  // Async component
  if (result instanceof Promise) {
    const m = captureMap(); const u = captureUnsuspend();
    return result.then((resolved) => {
      swapContextMap(m); restoreUnsuspend(u);
      // Check useId after the async body has finished executing.
      let asyncSavedIdTree: number | undefined;
      if (componentCalledUseId()) {
        asyncSavedIdTree = pushTreeContext(1, 0);
      }
      const r = renderNode(resolved, writer, isSvg);
      if (r && typeof (r as any).then === "function") {
        const m2 = captureMap(); const u2 = captureUnsuspend();
        // Only allocate cleanup closures when actually going async.
        return (r as Promise<void>).then(
          () => {
            swapContextMap(m2); restoreUnsuspend(u2);
            if (asyncSavedIdTree !== undefined) popTreeContext(asyncSavedIdTree);
            popComponentScope(savedScope);
            if (isProvider) popContextValue(ctx, prevCtxValue);
          },
          (e) => {
            swapContextMap(m2); restoreUnsuspend(u2);
            if (asyncSavedIdTree !== undefined) popTreeContext(asyncSavedIdTree);
            popComponentScope(savedScope);
            if (isProvider) popContextValue(ctx, prevCtxValue);
            throw e;
          },
        );
      }
      // Sync result from async component — inline cleanup.
      if (asyncSavedIdTree !== undefined) popTreeContext(asyncSavedIdTree);
      popComponentScope(savedScope);
      if (isProvider) popContextValue(ctx, prevCtxValue);
    }, (e) => {
      swapContextMap(m); restoreUnsuspend(u);
      // savedIdTree is always undefined here (async component skips the push).
      popComponentScope(savedScope);
      if (isProvider) popContextValue(ctx, prevCtxValue);
      throw e;
    });
  }

  const r = renderNode(result, writer, isSvg);

  if (r && typeof (r as any).then === "function") {
    const m = captureMap(); const u = captureUnsuspend();
    // Only allocate cleanup closures when actually going async.
    return (r as Promise<void>).then(
      () => {
        swapContextMap(m); restoreUnsuspend(u);
        if (savedIdTree !== undefined) popTreeContext(savedIdTree);
        popComponentScope(savedScope);
        if (isProvider) popContextValue(ctx, prevCtxValue);
      },
      (e) => {
        swapContextMap(m); restoreUnsuspend(u);
        if (savedIdTree !== undefined) popTreeContext(savedIdTree);
        popComponentScope(savedScope);
        if (isProvider) popContextValue(ctx, prevCtxValue);
        throw e;
      },
    );
  }
  // Sync path — inline cleanup, no closure allocation.
  if (savedIdTree !== undefined) popTreeContext(savedIdTree);
  popComponentScope(savedScope);
  if (isProvider) popContextValue(ctx, prevCtxValue);
}

/** Render an array of children, pushing tree-context for each child
 * so that `useId` produces deterministic, position-based IDs. */
function renderChildArray(
  children: SlimNode[],
  writer: Writer,
  isSvg: boolean,
): MaybePromise {
  return renderChildArrayFrom(children, 0, writer, isSvg);
}

/** Core child-array loop. Used by both the initial call and async continuations. */
function renderChildArrayFrom(
  children: SlimNode[],
  startIndex: number,
  writer: Writer,
  isSvg: boolean,
): MaybePromise {
  const totalChildren = children.length;
  for (let i = startIndex; i < totalChildren; i++) {
    // Inline isTextLike — avoids a function call on every child in every array.
    const child = children[i];
    if ((typeof child === "string" || typeof child === "number") && writer.lastWasText) {
      writer.write("<!-- -->");
    }
    const savedTree = pushTreeContext(totalChildren, i);
    const r = renderNode(child, writer, isSvg);
    if (r && typeof (r as any).then === "function") {
      const m = captureMap(); const u = captureUnsuspend();
      return (r as Promise<void>).then(() => {
        swapContextMap(m); restoreUnsuspend(u);
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

async function renderSuspense(
  props: Record<string, any>,
  writer: Writer,
  isSvg = false,
): Promise<void> {
  const { children, fallback } = props;
  // Snapshot tree-context so we can restore it if we need to render the fallback.
  const snap = snapshotContext();
  // Shallow-clone the context map so we can restore Provider values on fallback.
  // Provider push/pop pairs inside the failed children may not complete
  // symmetrically when SUSPENSE_RETRY_LIMIT is thrown.  The clone is a shallow
  // copy of a small Map (one entry per active Provider), so the cost is negligible.
  const savedMap = captureMap();
  const savedMapClone = savedMap ? new Map(savedMap) : null;
  // Collect all output into a buffer so we can discard it if the boundary
  // falls back to the loading state.
  const buffer = new BufferWriter();

  // Components handle their own Promise throws (see renderComponent catch block),
  // so renderNode either resolves synchronously or returns a Promise — it never
  // throws a Promise here. SUSPENSE_RETRY_LIMIT is thrown when a component
  // exhausts its retry budget, signalling us to render the fallback instead.
  try {
    const r = renderNode(children, buffer, isSvg);
    if (r && typeof (r as any).then === "function") {
      const m = captureMap(); const u = captureUnsuspend();
      await r;
      swapContextMap(m); restoreUnsuspend(u);
    }
    // Success – wrap with React's Suspense boundary markers so hydrateRoot
    // can locate the boundary in the DOM (<!--$--> … <!--/$-->).
    writer.write("<!--$-->");
    buffer.flushTo(writer);
    writer.write("<!--/$-->");
    // Tell a streaming writer it can encode and enqueue everything accumulated
    // so far — this is a natural boundary where partial HTML is complete.
    writer.flush?.();
  } catch (error) {
    if ((error as any) === SUSPENSE_RETRY_LIMIT) {
      // A component inside this boundary exhausted its retry budget.
      // Restore context to Suspense-entry state and render the fallback.
      restoreContext(snap);
      // Restore the context map to its pre-boundary state.
      swapContextMap(savedMapClone);
      writer.write("<!--$?-->");
      if (fallback) {
        const r = renderNode(fallback, writer, isSvg);
        if (r && typeof (r as any).then === "function") {
          const m = captureMap(); const u = captureUnsuspend();
          await r;
          swapContextMap(m); restoreUnsuspend(u);
        }
      }
      writer.write("<!--/$-->");
    } else {
      throw error;
    }
  }
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

// Module-level encoder — one instance shared across all renderToStream calls.
const _streamEncoder = new TextEncoder();

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
  const idPrefix = options?.identifierPrefix ?? "";

  return new ReadableStream({
    async start(controller) {
      resetRenderState(idPrefix);
      // Start with null — pushContextValue lazily creates the Map only if a
      // Context.Provider is actually rendered, eliminating the allocation on
      // the common (no-provider) path.
      const prev = swapContextMap(null);

      // Buffer writes into a string; only encode+enqueue in flush() so that
      // a sync render produces one Uint8Array instead of thousands of tiny ones.
      let _buf = "";
      const writer: Writer = {
        lastWasText: false,
        write(chunk: string) { _buf += chunk; this.lastWasText = false; },
        text(s: string)      { _buf += s;     this.lastWasText = true;  },
        flush() {
          if (_buf.length > 0) {
            controller.enqueue(_streamEncoder.encode(_buf));
            _buf = "";
          }
        },
      };

      try {
        const r = renderNode(element, writer);
        if (r && typeof (r as any).then === "function") {
          const m = captureMap(); await r; swapContextMap(m);
        }
        writer.flush!(); // encode everything accumulated (sync renders: the whole page)
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        swapContextMap(prev);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Preflight renderer
// ---------------------------------------------------------------------------

/** A writer that discards all output — only side-effects (cache warming, head
 *  population) are preserved. Used as the no-op sink for Pass 1. */
const NULL_WRITER: Writer = {
  lastWasText: false,
  write(_c: string) {},
  text(_s: string) {},
};

/**
 * Pass-1 preflight render.
 *
 * Walks the component tree with a NullWriter (discards all HTML output) so
 * that all `useServerData` promises are resolved into the `__hadarsUnsuspend`
 * cache and all `context.head` mutations are applied.
 *
 * Components self-retry on suspension at the component level (see
 * `renderComponent` catch block), so a single tree walk is sufficient.
 *
 * Call this before `renderToString` / `renderToStream` to guarantee a
 * suspension-free, fully-synchronous second pass.
 */
export async function renderPreflight(
  element: SlimNode,
  options?: RenderOptions,
): Promise<void> {
  const idPrefix = options?.identifierPrefix ?? "";
  // Start with null — pushContextValue lazily creates the Map only if a
  // Context.Provider is actually rendered.
  const prev = swapContextMap(null);
  try {
    resetRenderState(idPrefix);
    NULL_WRITER.lastWasText = false;
    // Components self-retry on suspension (see renderComponent catch block),
    // so a single pass is guaranteed to complete with all promises resolved.
    const r = renderNode(element, NULL_WRITER);
    if (r && typeof (r as any).then === "function") {
      const m = captureMap(); await r; swapContextMap(m);
    }
  } finally {
    swapContextMap(prev);
  }
}

/**
 * Render a component tree to a complete HTML string.
 *
 * Components self-retry on suspension at the component level (see
 * `renderComponent` catch block), so a single tree walk is sufficient
 * even when `useServerData` or similar hooks are used without an explicit
 * `<Suspense>` wrapper.
 */
export async function renderToString(
  element: SlimNode,
  options?: RenderOptions,
): Promise<string> {
  const idPrefix = options?.identifierPrefix ?? "";
  // Start with null — pushContextValue lazily creates the Map only if a
  // Context.Provider is actually rendered.
  const prev = swapContextMap(null);
  // Use a single mutable string rather than a chunks array + join() —
  // JSC/V8 use rope strings for += that are flattened once at return time,
  // avoiding all the array bookkeeping and the final allocation at join().
  let output = "";
  const writer: Writer = {
    lastWasText: false,
    write(c) { output += c; this.lastWasText = false; },
    text(s) { output += s; this.lastWasText = true; },
  };
  try {
    resetRenderState(idPrefix);
    // Components self-retry on suspension (see renderComponent catch block),
    // so a single pass is guaranteed to complete with all promises resolved.
    const r = renderNode(element, writer);
    if (r && typeof (r as any).then === "function") {
      const m = captureMap(); await r; swapContextMap(m);
    }
    return output;
  } finally {
    swapContextMap(prev);
  }
}

/** Alias matching React 18+ server API naming. */
export { renderToStream as renderToReadableStream };
