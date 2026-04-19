/**
 * React dispatcher shim for slim-react SSR.
 *
 * During a slim-react render the React dispatcher slot is null, so any
 * component that calls hooks via the real React package (e.g. `React.useId()`)
 * hits `resolveDispatcher() → null → error`.
 *
 * We install a minimal dispatcher for the duration of each component call so
 * those calls route through slim-react's tree-aware implementations.
 *
 * React 19: internals at `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H`
 * React 18: internals at `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current`
 *
 * In the rspack SSR bundle `react` is aliased to slim-react, which does not
 * export either internals key under the React 19 name. The namespace import
 * (`import * as`) returns `undefined` for missing properties rather than
 * throwing, so both `_r19` and `_r18` end up undefined and the
 * install/restore functions become safe no-ops — correct because the SSR
 * bundle already routes all hook calls through slim-react directly.
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

// React 19 exposes its shared internals under this key; `.H` is the dispatcher.
// Internals are discovered lazily on the first installDispatcher() call rather
// than at module evaluation time. slim-react/index.js re-exports symbols from
// the same bundled chunk as this file; accessing ReactNS properties at module
// init time creates a circular reference where the chunk hasn't finished
// evaluating yet, causing the getter to read an undefined module binding.
let _r19: { H: object | null } | undefined;
let _r18: { ReactCurrentDispatcher: { current: object | null } } | undefined;
let _detected = false;

function _detect() {
  if (_detected) return;
  _detected = true;
  // Bracket notation prevents rspack from treating this as a named-export access
  // on the "react" module (which would produce an ESModulesLinkingWarning).
  const r19 = (ReactNS as any)["__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE"];
  if (r19) { _r19 = r19; return; }
  const raw = (ReactNS as any)["__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED"];
  if (raw?.ReactCurrentDispatcher) _r18 = raw;
}

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
  _detect();
  if (_r19) {
    const prev = _r19.H;
    _r19.H = slimDispatcher;
    return prev;
  }
  if (_r18) {
    const prev = _r18.ReactCurrentDispatcher.current;
    _r18.ReactCurrentDispatcher.current = slimDispatcher;
    return prev;
  }
  return null;
}

export function restoreDispatcher(prev: object | null): void {
  _detect();
  if (_r19) _r19.H = prev;
  else if (_r18) _r18.ReactCurrentDispatcher.current = prev;
}
