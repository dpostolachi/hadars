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
  snapshotContext,
  restoreContext,
} from "./renderContext";

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
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
      key === "dangerouslySetInnerHTML"
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
              : key;
    }

    if (value === false || value == null) continue;
    if (value === true) {
      attrs += ` ${attrName}`;
      continue;
    }
    if (key === "style" && typeof value === "object") {
      attrs += ` style="${escapeAttr(styleObjectToString(value))}"`;
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
  write(chunk: string): void;
}

class BufferWriter implements Writer {
  chunks: string[] = [];
  write(chunk: string) {
    this.chunks.push(chunk);
  }
  flush(target: Writer) {
    for (const c of this.chunks) target.write(c);
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
    writer.write(escapeHtml(node));
    return;
  }
  if (typeof node === "number") {
    writer.write(String(node));
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

  // --- SlimElement ---
  if (
    typeof node === "object" &&
    node !== null &&
    "$$typeof" in node &&
    (node as SlimElement).$$typeof === SLIM_ELEMENT
  ) {
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

    // HTML / SVG element
    if (typeof type === "string") {
      return renderHostElement(type, props, writer, isSvg);
    }
  }
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

  const effectiveProps =
    enteringSvg && !props.xmlns
      ? { xmlns: "http://www.w3.org/2000/svg", ...props }
      : props;

  writer.write(`<${tag}${renderAttributes(effectiveProps, childSvg)}>`);

  const childContext = tag === "foreignObject" ? false : childSvg;

  let inner: MaybePromise = undefined;
  if (props.dangerouslySetInnerHTML) {
    writer.write(props.dangerouslySetInnerHTML.__html);
  } else {
    inner = renderChildren(props.children, writer, childContext);
  }

  if (inner && typeof (inner as any).then === "function") {
    return (inner as Promise<void>).then(() => {
      if (!VOID_ELEMENTS.has(tag)) writer.write(`</${tag}>`);
    });
  }
  if (!VOID_ELEMENTS.has(tag)) writer.write(`</${tag}>`);
}

// React special $$typeof symbols for memo, forwardRef, and context/provider
const REACT_MEMO        = Symbol.for("react.memo");
const REACT_FORWARD_REF = Symbol.for("react.forward_ref");
const REACT_PROVIDER    = Symbol.for("react.provider"); // React 18 Provider object
const REACT_CONTEXT     = Symbol.for("react.context");  // React 19 context-as-provider

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
    prevCtxValue = ctx._currentValue;
    ctx._currentValue = props.value;
  }

  // Each component gets a fresh local-ID counter (for multiple useId calls).
  const savedScope = pushComponentScope();

  let result: SlimNode;
  try {
    if (type.prototype && typeof type.prototype.render === "function") {
      const instance = new (type as any)(props);
      result = instance.render();
    } else {
      result = type(props);
    }
  } catch (e) {
    popComponentScope(savedScope);
    if (isProvider) ctx._currentValue = prevCtxValue;
    throw e;
  }

  const finish = () => {
    popComponentScope(savedScope);
    if (isProvider) ctx._currentValue = prevCtxValue;
  };

  // Async component
  if (result instanceof Promise) {
    return result.then((resolved) => {
      const r = renderNode(resolved, writer, isSvg);
      if (r && typeof (r as any).then === "function") {
        return (r as Promise<void>).then(finish);
      }
      finish();
    });
  }

  const r = renderNode(result, writer, isSvg);

  if (r && typeof (r as any).then === "function") {
    return (r as Promise<void>).then(finish);
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
    // React inserts <!-- --> between adjacent text-like nodes so the browser
    // preserves separate DOM text nodes — required for correct hydration.
    if (i > 0 && isTextLike(children[i]) && isTextLike(children[i - 1])) {
      writer.write("<!-- -->");
    }
    const savedTree = pushTreeContext(totalChildren, i);
    const r = renderNode(children[i], writer, isSvg);
    if (r && typeof (r as any).then === "function") {
      // One child went async – continue the rest asynchronously
      return (r as Promise<void>).then(() => {
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
    if (i > 0 && isTextLike(children[i]) && isTextLike(children[i - 1])) {
      writer.write("<!-- -->");
    }
    const savedTree = pushTreeContext(totalChildren, i);
    const r = renderNode(children[i], writer, isSvg);
    if (r && typeof (r as any).then === "function") {
      return (r as Promise<void>).then(() => {
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
    try {
      const buffer = new BufferWriter();
      const r = renderNode(children, buffer, isSvg);
      if (r && typeof (r as any).then === "function") {
        await r;
      }
      // Success – wrap with React's Suspense boundary markers so hydrateRoot
      // can locate the boundary in the DOM (<!--$--> … <!--/$-->).
      writer.write("<!--$-->");
      buffer.flush(writer);
      writer.write("<!--/$-->");
      return;
    } catch (error: unknown) {
      if (error && typeof (error as any).then === "function") {
        await (error as Promise<unknown>);
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
    if (r && typeof (r as any).then === "function") await r;
  }
  writer.write("<!--/$-->");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a component tree to a `ReadableStream<Uint8Array>`.
 *
 * The stream pauses at `<Suspense>` boundaries until the suspended
 * promise resolves, then continues writing HTML.
 */
export function renderToStream(element: SlimNode): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      resetRenderState();

      const writer: Writer = {
        write(chunk: string) {
          controller.enqueue(encoder.encode(chunk));
        },
      };

      try {
        const r = renderNode(element, writer);
        if (r && typeof (r as any).then === "function") await r;
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Convenience: render to a complete HTML string.
 * Retries the full tree when a component throws a Promise (Suspense protocol),
 * so useServerData and similar hooks work without requiring explicit <Suspense>.
 */
export async function renderToString(element: SlimNode): Promise<string> {
  for (let attempt = 0; attempt < MAX_SUSPENSE_RETRIES; attempt++) {
    resetRenderState();
    const chunks: string[] = [];
    const writer: Writer = { write(c) { chunks.push(c); } };
    try {
      const r = renderNode(element, writer);
      if (r && typeof (r as any).then === "function") await r;
      return chunks.join("");
    } catch (error) {
      if (error && typeof (error as any).then === "function") {
        await (error as Promise<unknown>);
        continue;
      }
      throw error;
    }
  }
  throw new Error("[slim-react] renderToString exceeded maximum retries");
}

/** Alias matching React 18+ server API naming. */
export { renderToStream as renderToReadableStream };
