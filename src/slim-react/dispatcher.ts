/**
 * React dispatcher shim for slim-react SSR.
 *
 * During a slim-react render, `React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H`
 * is null, so any component that calls `React.useId()` (or another hook) via
 * React's own package will hit `resolveDispatcher()` → null → error.
 *
 * We install a minimal dispatcher object for the duration of each component
 * call so that `React.useId()` routes through slim-react's tree-aware
 * `makeId()`.  All other hooks already have working SSR stubs in hooks.ts;
 * they are forwarded here so libraries that call them via `React.*` also work.
 *
 * In the Rspack SSR bundle `react` is aliased to `slim-react`, which does NOT
 * export `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`.
 * Accessing that property via a namespace import (`import * as`) always returns
 * `undefined` safely — `import default from "react"` would crash via interop
 * because Rspack compiles it as `require("react").default`, and slim-react has
 * no `default` export, so `.default` itself is `undefined` and the subsequent
 * property access throws.
 *
 * With the namespace import, `_internals` is `undefined` in the SSR bundle and
 * the install/restore functions become no-ops, which is correct: the SSR bundle
 * already routes all `React.*` hook calls to slim-react's own implementations.
 */

import { makeId, getContextValue } from "./renderContext";
import {
  useState, useReducer, useEffect, useLayoutEffect, useInsertionEffect,
  useRef, useMemo, useCallback, useDebugValue, useImperativeHandle,
  useSyncExternalStore, useTransition, useDeferredValue,
  useOptimistic, useActionState, use,
} from "./hooks";

// Use namespace import so that when `react` is aliased to slim-react in the
// Rspack SSR bundle, `ReactNS` is always an object (never undefined), and
// accessing a missing property returns `undefined` rather than throwing.
import * as ReactNS from "react";

// React 19 exposes its shared internals under this key.
// Bracket notation prevents rspack from treating this as a named-export access
// on the "react" module (which would produce an ESModulesLinkingWarning).
const _reactInternalsKey = "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE";
const _internals: { H: object | null } | undefined =
  (ReactNS as any)[_reactInternalsKey];

// The dispatcher object we install. We keep a stable reference so the same
// object is reused across every component call.
const slimDispatcher: Record<string, unknown> = {
  useId: makeId,
  readContext: (ctx: any) => getContextValue(ctx),
  useContext: (ctx: any) => getContextValue(ctx),
  useState,
  useReducer,
  useEffect,
  useLayoutEffect,
  useInsertionEffect,
  useRef,
  useMemo,
  useCallback,
  useDebugValue,
  useImperativeHandle,
  useSyncExternalStore,
  useTransition,
  useDeferredValue,
  useOptimistic,
  useActionState,
  use,
  // React internals that compiled output may call
  useMemoCache: (size: number) => new Array(size).fill(undefined),
  useCacheRefresh: () => () => {},
  useHostTransitionStatus: () => false,
};

/**
 * Install the slim dispatcher and return the previous value.
 * Call `restoreDispatcher(prev)` when the component finishes.
 */
export function installDispatcher(): object | null {
  if (!_internals) return null;
  const prev = _internals.H;
  _internals.H = slimDispatcher;
  return prev;
}

export function restoreDispatcher(prev: object | null): void {
  if (_internals) _internals.H = prev;
}
