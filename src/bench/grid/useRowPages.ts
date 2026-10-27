/**
 * Row pages of a windowed frame (datatoolkit-issues#329): fetches the pages
 * around the viewport with a look-ahead in the scroll direction, cancels the
 * ones the user scrolled past, keeps a bounded set (`MAX_PAGES`).
 */
import { useCallback, useEffect, useReducer, useRef } from "react";

import { apiClient } from "../../api/client";
import {
  errorText,
  type Role,
  type Workspace,
  type WorkspaceRow,
} from "../../api/types";
import type { GridView } from "../../state/gridView";
import {
  MAX_INFLIGHT,
  PAGE_ROWS,
  RowPages,
  wantedPages,
} from "./rowWindow";

/** Scrolling is coalesced: at most one fetch round per interval. */
const FETCH_INTERVAL_MS = 60;
/** A failed page is asked again after this long, when it is wanted again. */
const RETRY_MS = 3000;

export interface RowPagesOptions {
  workspace: Workspace;
  role: Role;
  version: number;
  view: GridView;
  total: number;
  /** False while `seed` is not the frame of `workspace` / `view` yet: nothing is fetched. */
  enabled: boolean;
  /** Rows from offset 0 already fetched; the store restarts when this changes. */
  seed: WorkspaceRow[];
  /** Resets the store with `seed` (identity + grid view of the frame). */
  resetKey: string;
  /** One call per burst of failures; `onRecover` follows when a page then loads. */
  onError: (message: string) => void;
  onRecover?: () => void;
}

export interface RowPagesApi {
  row: (i: number) => WorkspaceRow | undefined;
  /** The rows [first, end) are on screen; scrolling `dir` (1 = down). */
  want: (first: number, end: number, dir: 1 | -1) => void;
  /** Pages in memory, for tests and the status line. */
  loadedPages: () => number[];
}

export function useRowPages(opts: RowPagesOptions): RowPagesApi {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const storeRef = useRef<RowPages | null>(null);
  const keyRef = useRef<string | null>(null);
  const inflight = useRef(new Map<number, AbortController>());
  const failedAt = useRef(new Map<number, number>());
  const range = useRef({ first: 0, end: 0, dir: 1 as 1 | -1 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorShown = useRef(false);

  // A new frame / grid view restarts the store in the same render, so the
  // first paint already shows the seeded rows and no stale page.
  const key = `${opts.resetKey}|${opts.seed.length}`;
  if (keyRef.current !== key || storeRef.current === null) {
    for (const c of inflight.current.values()) c.abort();
    inflight.current.clear();
    failedAt.current.clear();
    errorShown.current = false;
    const store = new RowPages();
    store.seed(opts.seed);
    storeRef.current = store;
    keyRef.current = key;
  }

  const run = useCallback(() => {
    timer.current = null;
    const store = storeRef.current;
    if (!store) return;
    const { workspace, role, version, view, total, enabled } = optsRef.current;
    if (!enabled) return;
    const { first, end, dir } = range.current;
    const wanted = wantedPages(first, end, total, dir);
    const want = new Set(wanted);
    store.setFocus(Math.floor(first / PAGE_ROWS));
    for (const [p, c] of inflight.current) {
      if (!want.has(p)) {
        c.abort();
        inflight.current.delete(p);
      }
    }
    const now = Date.now();
    for (const p of wanted) {
      if (inflight.current.size >= MAX_INFLIGHT) break;
      if (store.has(p) || inflight.current.has(p)) continue;
      const failed = failedAt.current.get(p);
      if (failed !== undefined && now - failed < RETRY_MS) continue;
      const ctl = new AbortController();
      inflight.current.set(p, ctl);
      apiClient
        .workspaceRows(
          workspace,
          role,
          version,
          p * PAGE_ROWS,
          PAGE_ROWS,
          ctl.signal,
          view,
          true,
        )
        .then((res) => {
          if (storeRef.current !== store || ctl.signal.aborted) return;
          failedAt.current.delete(p);
          store.put(p, res.rows);
          if (errorShown.current) {
            errorShown.current = false;
            optsRef.current.onRecover?.();
          }
        })
        .catch((e: unknown) => {
          if (storeRef.current !== store || ctl.signal.aborted) return;
          failedAt.current.set(p, Date.now());
          if (!errorShown.current) {
            errorShown.current = true;
            optsRef.current.onError(errorText(e));
          }
        })
        .finally(() => {
          if (inflight.current.get(p) === ctl) inflight.current.delete(p);
          if (storeRef.current !== store) return;
          bump();
          // Slots freed: carry on with the pages still missing.
          if (timer.current === null) {
            timer.current = setTimeout(run, FETCH_INTERVAL_MS);
          }
        });
    }
    // A wanted page that failed is asked again without a new scroll.
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    let retryIn: number | null = null;
    for (const p of wanted) {
      const failed = failedAt.current.get(p);
      if (failed === undefined || store.has(p)) continue;
      const left = Math.max(RETRY_MS - (now - failed), 0);
      retryIn = retryIn === null ? left : Math.min(retryIn, left);
    }
    if (retryIn !== null) {
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        if (timer.current === null) run();
      }, retryIn + 1);
    }
  }, []);

  const want = useCallback(
    (first: number, end: number, dir: 1 | -1) => {
      const r = range.current;
      if (r.first === first && r.end === end && r.dir === dir) return;
      range.current = { first, end, dir };
      if (timer.current === null) {
        timer.current = setTimeout(run, FETCH_INTERVAL_MS);
      }
    },
    [run],
  );

  // A restarted store has pages to fetch even when the viewport did not move.
  useEffect(() => {
    if (timer.current === null) timer.current = setTimeout(run, 0);
  }, [key, run, opts.enabled]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      // StrictMode remounts with the same refs: a stale handle would block every later round.
      timer.current = null;
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      for (const c of inflight.current.values()) c.abort();
      inflight.current.clear();
    },
    [],
  );

  const row = useCallback(
    (i: number) => storeRef.current?.row(i),
    // The store is replaced on reset; callers re-render with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const loadedPages = useCallback(() => storeRef.current?.pageIndexes() ?? [], []);
  return { row, want, loadedPages };
}
