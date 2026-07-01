// React shim — re-exports React from QwenPaw host environment.
// Source files use `import { useState } from "react"` which resolves here via vite alias.

const _host = (window as any).QwenPaw?.host;
const _React = _host?.React;

if (!_React) {
  throw new Error("[dialog-index-plugin] QwenPaw host React not available");
}

// CRITICAL: jsxRuntime "classic" compiles JSX to React.createElement(),
// which requires a global `React` variable. Set it on window.
(window as any).React = _React;

// Re-export hooks and components for named imports
export const {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useContext,
  useReducer,
  useLayoutEffect,
  useImperativeHandle,
  useDebugValue,
  useDeferredValue,
  useTransition,
  useId,
  useSyncExternalStore,
  useInsertionEffect,
  createElement,
  createContext,
  createRef,
  forwardRef,
  Fragment,
  memo,
  lazy,
  Suspense,
  startTransition,
  Children,
  Component,
  PureComponent,
  cloneElement,
  isValidElement,
  StrictMode,
  version,
} = _React;

export default _React;

// react-dom shim
const _ReactDOM = _host?.ReactDOM;
export const createPortal = _ReactDOM?.createPortal;
export const flushSync = _ReactDOM?.flushSync;
