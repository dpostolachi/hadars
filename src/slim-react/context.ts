import type { SlimNode } from "./types";
import { getContextValue } from "./renderContext";

/**
 * Minimal Context implementation for SSR.
 *
 * Because SSR is single-pass and synchronous within each component,
 * we just track the "current" value on the context object and
 * save / restore around Provider renders (handled by the renderer).
 */

export interface Context<T> {
  _defaultValue: T;
  _currentValue: T; // kept for external compat (real React contexts passed to useContext)
  Provider: ContextProvider<T>;
  Consumer: (props: { children: (value: T) => SlimNode }) => SlimNode;
}

export type ContextProvider<T> = ((props: {
  value: T;
  children?: SlimNode;
}) => SlimNode) & {
  _context: Context<T>;
};

export function createContext<T>(defaultValue: T): Context<T> {
  const context: Context<T> = {
    _defaultValue: defaultValue,
    _currentValue: defaultValue,
    Provider: null!,
    Consumer: null!,
  };

  // Provider is a function component recognised by the renderer.
  // The `_context` tag tells the renderer to push / pop the value.
  const Provider = function ContextProvider({
    children,
  }: {
    value: T;
    children?: SlimNode;
  }): SlimNode {
    return children ?? null;
  } as unknown as ContextProvider<T>;

  Provider._context = context;
  context.Provider = Provider;

  context.Consumer = ({ children }) => {
    return (children as unknown as (value: T) => SlimNode)(
      getContextValue<T>(context),
    );
  };

  return context;
}
