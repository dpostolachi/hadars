/**
 * SSR hook implementations.
 *
 * On the server every hook is either a no-op or returns the initial /
 * snapshot value.  This is enough for the vast majority of React-
 * compatible libraries to work during server-side rendering.
 */

import { makeId } from "./renderContext";

// ---- useState ----
export function useState<T>(
  initialState: T | (() => T),
): [T, (value: T | ((prev: T) => T)) => void] {
  const value =
    typeof initialState === "function"
      ? (initialState as () => T)()
      : initialState;
  return [value, () => {}];
}

// ---- useReducer ----
export function useReducer<S, A>(
  _reducer: (state: S, action: A) => S,
  initialState: S,
): [S, (action: A) => void] {
  return [initialState, () => {}];
}

// ---- useEffect / useLayoutEffect / useInsertionEffect ----
export function useEffect(
  _effect: () => void | (() => void),
  _deps?: any[],
) {}
export function useLayoutEffect(
  _effect: () => void | (() => void),
  _deps?: any[],
) {}
export function useInsertionEffect(
  _effect: () => void | (() => void),
  _deps?: any[],
) {}

// ---- useRef ----
export function useRef<T>(initialValue: T): { current: T } {
  return { current: initialValue };
}

// ---- useMemo / useCallback ----
export function useMemo<T>(factory: () => T, _deps?: any[]): T {
  return factory();
}
export function useCallback<T extends Function>(callback: T, _deps?: any[]): T {
  return callback;
}

// ---- useId ----
export function useId(): string {
  return makeId();
}

// ---- useDebugValue ----
export function useDebugValue(_value: any, _format?: (v: any) => any) {}

// ---- useImperativeHandle ----
export function useImperativeHandle(
  _ref: any,
  _createHandle: () => any,
  _deps?: any[],
) {}

// ---- useSyncExternalStore ----
export function useSyncExternalStore<T>(
  _subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  return (getServerSnapshot || getSnapshot)();
}

// ---- useTransition ----
export function useTransition(): [boolean, (callback: () => void) => void] {
  return [false, (cb) => cb()];
}

// ---- useDeferredValue ----
export function useDeferredValue<T>(value: T): T {
  return value;
}

// ---- useOptimistic (React 19) ----
export function useOptimistic<T>(passthrough: T): [T, () => void] {
  return [passthrough, () => {}];
}

// ---- useFormStatus (React 19) ----
export function useFormStatus() {
  return { pending: false, data: null, method: null, action: null };
}

// ---- useActionState (React 19) ----
export function useActionState<S>(
  _action: (state: S, payload: any) => S | Promise<S>,
  initialState: S,
  _permalink?: string,
): [S, (payload: any) => void, boolean] {
  return [initialState, () => {}, false];
}

// ---- use (React 19 – Suspense integration) ----
export function use<T>(
  usable: (Promise<T> & { status?: string; value?: T; reason?: any }) | { _currentValue: T },
): T {
  // Context object
  if (
    typeof usable === "object" &&
    usable !== null &&
    "_currentValue" in usable
  ) {
    return (usable as { _currentValue: T })._currentValue;
  }

  // Promise – Suspense protocol
  const promise = usable as Promise<T> & {
    status?: string;
    value?: T;
    reason?: any;
  };
  if (promise.status === "fulfilled") return promise.value!;
  if (promise.status === "rejected") throw promise.reason;
  throw promise; // caught by the nearest Suspense boundary
}

// ---- startTransition ----
export function startTransition(callback: () => void) {
  callback();
}
