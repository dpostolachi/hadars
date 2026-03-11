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
 */

import { makeId, getContextValue } from "./renderContext";
import {
  useState, useReducer, useEffect, useLayoutEffect, useInsertionEffect,
  useRef, useMemo, useCallback, useDebugValue, useImperativeHandle,
  useSyncExternalStore, useTransition, useDeferredValue,
  useOptimistic, useActionState, use,
} from "./hooks";

import ReactPkg from "react";

// React 19 exposes its shared internals under this key.
const _internals: { H: object | null } | undefined =
  (ReactPkg as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

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
