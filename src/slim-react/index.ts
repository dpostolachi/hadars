/**
 * slim-react – a lightweight, SSR-only React-compatible runtime.
 *
 * Provides just enough of the React API surface to server-render
 * components that use hooks, Context and Suspense.
 */

// ---- Symbols & types ----
export {
  SLIM_ELEMENT,
  FRAGMENT_TYPE,
  SUSPENSE_TYPE,
  type SlimElement,
  type SlimNode,
  type ComponentFunction,
} from "./types";

// ---- JSX runtime ----
import { jsx, jsxs, jsxDEV, createElement, Fragment } from "./jsx";
export { jsx, jsxs, jsxDEV, createElement, Fragment };

// ---- Hooks (SSR stubs) ----
import {
  useState,
  useReducer,
  useEffect,
  useLayoutEffect,
  useInsertionEffect,
  useRef,
  useMemo,
  useCallback,
  useId,
  useDebugValue,
  useImperativeHandle,
  useSyncExternalStore,
  useTransition,
  useDeferredValue,
  useOptimistic,
  useFormStatus,
  useActionState,
  use,
  startTransition,
} from "./hooks";
export {
  useState,
  useReducer,
  useEffect,
  useLayoutEffect,
  useInsertionEffect,
  useRef,
  useMemo,
  useCallback,
  useId,
  useDebugValue,
  useImperativeHandle,
  useSyncExternalStore,
  useTransition,
  useDeferredValue,
  useOptimistic,
  useFormStatus,
  useActionState,
  use,
  startTransition,
};

// ---- Context ----
import { createContext } from "./context";
export { createContext, type Context } from "./context";

// Re-export useContext from hooks.ts? No – we have it in context.ts
// Actually useContext reads from the context object, let's export a
// single implementation that lives close to createContext:
import type { Context } from "./context";
export function useContext<T>(context: Context<T>): T {
  return context._currentValue;
}

// ---- Rendering ----
import { renderToStream, renderToString, renderToReadableStream } from "./render";
export { renderToStream, renderToString, renderToReadableStream };

// ---- Suspense (as a JSX tag) ----
import { SUSPENSE_TYPE } from "./types";
export const Suspense = SUSPENSE_TYPE;

// ---- Compat utilities ----
import { SLIM_ELEMENT, type SlimElement, type SlimNode } from "./types";

export function isValidElement(obj: unknown): obj is SlimElement {
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as any).$$typeof === SLIM_ELEMENT
  );
}

export function cloneElement(
  element: SlimElement,
  overrideProps?: Record<string, any>,
  ...children: SlimNode[]
): SlimElement {
  return {
    $$typeof: SLIM_ELEMENT,
    type: element.type,
    props: {
      ...element.props,
      ...overrideProps,
      ...(children.length === 1
        ? { children: children[0] }
        : children.length > 1
          ? { children }
          : {}),
    },
    key: overrideProps?.key ?? element.key,
  };
}

export function forwardRef<P = any>(
  render: (props: P, ref: any) => SlimNode,
): (props: P & { ref?: any }) => SlimNode {
  const component = (props: P & { ref?: any }) =>
    render(props, (props as any).ref ?? null);
  (component as any).displayName =
    (render as any).displayName || (render as any).name || "ForwardRef";
  return component;
}

export function memo<P = any>(
  component: (props: P) => SlimNode,
): (props: P) => SlimNode {
  return component; // no memoisation needed for SSR
}

export function lazy<P = any>(
  factory: () => Promise<{ default: (props: P) => SlimNode }>,
): (props: P) => SlimNode {
  let resolved: ((props: P) => SlimNode) | null = null;
  let promise: Promise<void> | null = null;

  return function LazyComponent(props: P): SlimNode {
    if (resolved) return resolved(props);
    if (!promise) {
      promise = factory().then((mod) => {
        resolved = mod.default;
      });
    }
    throw promise; // Suspense protocol
  };
}

// ---- Children helpers ----
function toFlatArray(children: SlimNode): SlimNode[] {
  if (children == null || typeof children === "boolean") return [];
  if (Array.isArray(children)) return children.flatMap(toFlatArray);
  return [children];
}

export const Children = {
  map(
    children: SlimNode,
    fn: (child: SlimNode, index: number) => SlimNode,
  ): SlimNode[] {
    return toFlatArray(children).map((child, i) => fn(child, i));
  },
  forEach(
    children: SlimNode,
    fn: (child: SlimNode, index: number) => void,
  ): void {
    toFlatArray(children).forEach((child, i) => fn(child, i));
  },
  count(children: SlimNode): number {
    return toFlatArray(children).length;
  },
  only(children: SlimNode): SlimElement {
    const arr = toFlatArray(children);
    if (arr.length !== 1) throw new Error("Children.only expected one child");
    return arr[0] as SlimElement;
  },
  toArray: toFlatArray,
};

// ---- React.Component (basic class component support) ----
export class Component<P = {}, S = {}> {
  props: P;
  state: S;
  context: any;

  constructor(props: P) {
    this.props = props;
    this.state = {} as S;
  }

  setState(_partial: Partial<S> | ((prev: S) => Partial<S>)) {}
  forceUpdate() {}
  render(): SlimNode {
    return null;
  }
}

export class PureComponent<P = {}, S = {}> extends Component<P, S> {}

// ---- Default export ----
// Mirrors `import React from 'react'` so code that uses React.useState,
// React.createContext, React.Suspense, etc. works without changes.
// All names here are already imported/defined above — no re-imports needed.
const React = {
  // Hooks
  useState, useReducer, useEffect, useLayoutEffect, useInsertionEffect,
  useRef, useMemo, useCallback, useId, useDebugValue, useImperativeHandle,
  useSyncExternalStore, useTransition, useDeferredValue,
  useOptimistic, useFormStatus, useActionState, use, startTransition,
  // Context
  createContext, useContext,
  // Elements
  createElement, cloneElement, isValidElement, forwardRef, memo, lazy,
  Fragment, Suspense,
  // Compat
  Children, Component, PureComponent,
  // Rendering
  renderToStream, renderToString, renderToReadableStream,
  // Version stub
  version: "19.0.0-slim",
};

export default React;
