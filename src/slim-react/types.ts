// ---- Symbols ----
// Use the same symbols as React so elements produced here are wire-compatible
// with elements produced by the real React JSX runtime (e.g. when a library
// uses React.createElement directly).  This means the SSR bundle can be aliased
// to slim-react without any element shape mismatch.
export const SLIM_ELEMENT  = Symbol.for("react.element");
export const FRAGMENT_TYPE = Symbol.for("react.fragment");
export const SUSPENSE_TYPE = Symbol.for("react.suspense");

// ---- Types ----
export type ComponentFunction = (props: any) => SlimNode;

export type SlimElement = {
  $$typeof: typeof SLIM_ELEMENT;
  type: string | ComponentFunction | symbol;
  props: Record<string, any>;
  key: string | number | null;
};

export type SlimNode =
  | SlimElement
  | string
  | number
  | boolean
  | null
  | undefined
  | SlimNode[];
