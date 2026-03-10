import {
  SLIM_ELEMENT,
  FRAGMENT_TYPE,
  type SlimElement,
  type SlimNode,
  type ComponentFunction,
} from "./types";

// ---- Fragment ----
export const Fragment = FRAGMENT_TYPE;

// ---- jsx / jsxs (automatic transform) ----
// The automatic JSX transform calls jsx(type, props, key?)
// where props already contains `children`.
export function jsx(
  type: string | ComponentFunction | symbol,
  props: Record<string, any>,
  key?: string | number | null,
): SlimElement {
  return {
    $$typeof: SLIM_ELEMENT,
    type,
    props: props || {},
    key: key ?? (props?.key ?? null),
  };
}

export { jsx as jsxs, jsx as jsxDEV };

// ---- createElement (classic transform) ----
export function createElement(
  type: string | ComponentFunction | symbol,
  props?: Record<string, any> | null,
  ...children: SlimNode[]
): SlimElement {
  const normalizedProps: Record<string, any> = { ...(props || {}) };

  if (children.length === 1) {
    normalizedProps.children = children[0];
  } else if (children.length > 1) {
    normalizedProps.children = children;
  }

  const key = normalizedProps.key ?? null;
  delete normalizedProps.key;

  return {
    $$typeof: SLIM_ELEMENT,
    type,
    props: normalizedProps,
    key,
  };
}
