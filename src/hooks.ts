import { useEffect, useRef, useState } from "react";

import { errorText } from "./api/types";

interface KeyedAsync<T> {
  /** Last settled value, kept while the next key loads; undefined after a failure. */
  value: T | undefined;
  /** Failure of the current key. */
  error: string | null;
  /** True once the current key has settled (or when idle). */
  ready: boolean;
  /** Key the value was settled for (null before the first settle). */
  settledKey: string | null;
}

const IDLE = { value: undefined, error: null, ready: true, settledKey: null } as const;

/**
 * Runs `run` once per distinct `key` (null = idle) and drops superseded runs.
 * `run` is read at call time, so it may close over fresh props without being a
 * dependency: callers put in `key` exactly what should trigger a re-run.
 * `enabled = false` defers the run; it never re-runs a key that has settled.
 */
export function useKeyedAsync<T>(
  key: string | null,
  run: (alive: () => boolean) => Promise<T>,
  enabled = true,
): KeyedAsync<T> {
  const [state, setState] = useState<{
    key: string | null;
    value?: T;
    error: string | null;
  }>({ key: null, error: null });
  const runRef = useRef(run);
  runRef.current = run;
  const settled = useRef<string | null>(null);

  useEffect(() => {
    if (key === null || !enabled || key === settled.current) return;
    let alive = true;
    const settle = (value: T | undefined, error: string | null) => {
      if (!alive) return;
      settled.current = key;
      setState({ key, value, error });
    };
    runRef.current(() => alive).then(
      (value) => settle(value, null),
      (e: unknown) => settle(undefined, errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [key, enabled]);

  if (key === null) return IDLE;
  const ready = state.key === key;
  return {
    value: state.value,
    error: ready ? state.error : null,
    ready,
    settledKey: state.key,
  };
}
