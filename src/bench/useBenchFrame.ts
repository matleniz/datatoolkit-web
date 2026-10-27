/**
 * Frame half of the workbench data layer: rows, profiles and pipeline shapes
 * of the viewed (role, version), refetched whenever its identity changes.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
} from "react";

import { apiClient, onSourceFilesWritten } from "../api/client";
import {
  EngineError,
  errorText,
  type ColumnProfile,
  type ColumnProfiles,
  type ProfileSample,
  type Role,
  type Workspace,
  type WorkspaceRow,
  type WorkspaceRowsColumn,
} from "../api/types";
import { gridViewKey, isGridViewActive, type GridView } from "../state/gridView";
import type { AppAction } from "../state/reducer";
import { dataIdentity } from "./dataIdentity";
import {
  PAGE_DEFAULT,
  PAGE_WIDE,
  rowsPageSize,
  WIDE_COL_THRESHOLD,
} from "./grid/columnWindow";
import { FrameCache, isCacheable } from "./frameCache";
import { preferKnownColumns } from "./profileColumns";
import {
  effectiveVersion,
  latestVersion,
  normalizeProfiles,
  shapesStructureKey,
} from "./version";

export interface PipelineShape {
  rows: number;
  cols: number;
}

interface Frame {
  columns: WorkspaceRowsColumn[];
  rows: WorkspaceRow[];
  total: number;
  /** Rows before the view-only filter (= `total` without one). */
  totalUnfiltered: number;
  /**
   * Engine `duckdb` very large CSV: `rows` is only the first response; the grid
   * pages the rest by window (#329).
   */
  windowed: boolean;
  profiles: Map<string, ColumnProfile>;
  /** Identity of the frame held in `rows` / `columns` (null = none). */
  rowsIdentity: string | null;
  /** `gridViewKey` of the view-only filter / sort `rows` were fetched with. */
  rowsGridKey: string | null;
  /** Identity of the frame held in `profiles` (null = none). */
  profilesIdentity: string | null;
  /** Set when the profiles (quality bars, stats) come from a row sample (#318). */
  profileSample: ProfileSample | null;
}

interface Shapes {
  shapes: PipelineShape[];
  stepErrors: Map<number, string>;
}

/** A loaded frame and the pipeline shapes it was shown with (#245). */
interface CachedFrame {
  frame: Frame;
  shapes: Shapes;
  structureKey: string;
}

const frameCache = new FrameCache<CachedFrame>();
// The file behind a cached frame may have changed while Studio was out of
// sight (edited in another program) or through an upload.
onSourceFilesWritten(() => frameCache.clear());
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") frameCache.clear();
  });
}

const EMPTY_FRAME: Frame = {
  columns: [],
  rows: [],
  total: 0,
  totalUnfiltered: 0,
  windowed: false,
  profiles: new Map(),
  rowsIdentity: null,
  rowsGridKey: null,
  profilesIdentity: null,
  profileSample: null,
};
const ZERO_SHAPE: PipelineShape = { rows: 0, cols: 0 };
const NO_SHAPES: Shapes = { shapes: [], stepErrors: new Map() };

/**
 * Narrow (or already-known narrow): one page fetch — skip the peek.
 * Wide / unknown: peek limit=1 for the column count then size the page
 * (MAT-152 — wide frames must not pull PAGE_DEFAULT rows).
 */
async function fetchRowsPage(
  ws: Workspace,
  role: Role,
  ver: number,
  knownCols: number,
  alive: () => boolean,
  view: GridView,
) {
  if (knownCols > 0) {
    const limit = knownCols < WIDE_COL_THRESHOLD ? PAGE_DEFAULT : PAGE_WIDE;
    return apiClient.workspaceRows(ws, role, ver, 0, limit, undefined, view);
  }
  const peek = await apiClient.workspaceRows(ws, role, ver, 0, 1);
  const page = rowsPageSize(peek.columns.length);
  if (!alive()) return peek;
  if (page <= 1 && !isGridViewActive(view)) return peek;
  return apiClient.workspaceRows(ws, role, ver, 0, page, undefined, view);
}

/**
 * MAT-167: legacy wrong-kind specs can "succeed" with 0 rows and garbage
 * columns (nested JSON read as csv). Returns the mismatch message, if any.
 */
async function sourceMismatch(ws: Workspace): Promise<string | null> {
  const { path, kind: storedKind } = ws.datasets.train.x;
  try {
    const inspect = await apiClient.runKey("file_inspect", { path });
    const raw = inspect.metrics?.load_spec;
    if (typeof raw !== "string" || !raw) return null;
    const parsed = JSON.parse(raw) as { kind?: string; record_path?: string };
    if (!parsed.kind || parsed.kind === storedKind) return null;
    const extra =
      parsed.kind === "json" && parsed.record_path
        ? ` (record_path ${JSON.stringify(parsed.record_path)})`
        : "";
    return `Stored train source failed to parse: saved as ${storedKind} but file_inspect detects ${parsed.kind}${extra}. Re-inspect the file on Sources.`;
  } catch {
    return null; // empty-state already visible
  }
}

/** Frames above this many rows get a sampled profile (engine `sample_rows`, #318). */
const PROFILE_SAMPLE_ROWS = 100_000;

/** The sample a profile response discloses, null for a full profile. */
function sampleOf(res: ColumnProfiles): ProfileSample | null {
  if (!res.sampled || !res.n_rows_source) return null;
  return { nRowsSource: res.n_rows_source, nSampledOut: res.n_sampled_out ?? 0 };
}

/**
 * Profiles of the viewport columns first (wide frames), then the rest. Today's
 * engine ignores the filter and returns every column in one shot.
 */
async function loadProfiles(
  ws: Workspace,
  role: Role,
  ver: number,
  firstCols: string[] | null,
  totalCols: number,
  alive: () => boolean,
  publish: (cols: ColumnProfile[], sample: ProfileSample | null) => void,
  sampleRows: number | null,
) {
  let first: Awaited<ReturnType<typeof apiClient.columnProfiles>> | undefined;
  if (firstCols) {
    try {
      first = await apiClient.columnProfiles(ws, role, ver, firstCols, sampleRows);
    } catch (e) {
      // Residual stale names (or race): fall back to unscoped instead of
      // SET_BENCH_ERROR when the engine rejects unknowns.
      if (!(e instanceof EngineError) || e.status !== 422) throw e;
    }
  }
  const scopedOk = first !== undefined;
  first ??= await apiClient.columnProfiles(ws, role, ver, null, sampleRows);
  if (!alive()) return;
  const { columns } = normalizeProfiles(first);
  publish(columns, sampleOf(first));
  if (!scopedOk || columns.length >= totalCols) return;
  const all = await apiClient.columnProfiles(ws, role, ver, null, sampleRows);
  if (alive()) publish(normalizeProfiles(all).columns, sampleOf(all));
}

async function peekShape(ws: Workspace, role: Role, v: number) {
  try {
    const r = await apiClient.workspaceRows(ws, role, v, 0, 1);
    return { v, shape: { rows: r.total, cols: r.columns.length }, error: null };
  } catch (e) {
    return { v, shape: null, error: errorText(e) };
  }
}

/** Shape of every pipeline version; the viewed one is already known (`own`). */
async function fetchShapes(
  ws: Workspace,
  role: Role,
  ver: number,
  own: PipelineShape,
): Promise<Shapes & { rootError: string | null }> {
  const n = ws.steps.length;
  if (n === 0) return { shapes: [own], stepErrors: new Map(), rootError: null };
  // Independent shape peeks — parallelize.
  const others = Array.from({ length: n + 1 }, (_, v) => v).filter(
    (v) => v !== ver,
  );
  const settled = await Promise.all(others.map((v) => peekShape(ws, role, v)));
  const shapes: (PipelineShape | undefined)[] = new Array(n + 1);
  shapes[ver] = own;
  const stepErrors = new Map<number, string>();
  let rootError: string | null = null;
  // In version order, so a failed step fills from the previous known shape and
  // every later version inherits it.
  for (const { v, shape, error } of settled) {
    if (shape) {
      shapes[v] = shape;
      continue;
    }
    if (v > 0) stepErrors.set(v - 1, error);
    else rootError = error;
    shapes[v] = shapes[v - 1] ?? ZERO_SHAPE;
    for (let u = v + 1; u <= n; u++) shapes[u] ??= shapes[v];
    break;
  }
  return {
    shapes: Array.from(
      shapes,
      (s, i) => s ?? shapes[ver] ?? shapes[i - 1] ?? ZERO_SHAPE,
    ),
    stepErrors,
    rootError,
  };
}

export function useBenchFrame(
  workspace: Workspace | null,
  role: Role,
  viewVersion: number | null,
  dispatch: Dispatch<AppAction>,
  gridView: GridView,
) {
  const [frame, setFrame] = useState<Frame>(EMPTY_FRAME);
  const [{ shapes, stepErrors }, setShapes] = useState<Shapes>(NO_SHAPES);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const frameRef = useRef(frame);
  frameRef.current = frame;
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const visibleColsRef = useRef<string[]>([]);
  const fetchGen = useRef(0);
  const prevViewKeyRef = useRef<string | null>(null);
  const prevStructureRef = useRef<string | null>(null);
  const prevTickRef = useRef(0);
  /** The frame on screen carries a load-time error (not cacheable). */
  const loadErrorRef = useRef(false);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  // A ref, not state: only read when the next profile fetch starts.
  const reportVisibleColumns = useCallback((names: string[]) => {
    visibleColsRef.current = names;
  }, []);

  const version = workspace ? effectiveVersion(workspace, viewVersion) : 0;
  const isLatest = workspace ? version === latestVersion(workspace) : true;
  const identity = useMemo(
    () => dataIdentity(workspace, role, version),
    [workspace, role, version],
  );
  const identityKey = identity.key;
  const structureKey = shapesStructureKey(workspace, role);
  /** Time-travel / role identity — not the effective version number (delete/add keep "latest"). */
  const gridKey = gridViewKey(gridView);
  const gridViewRef = useRef(gridView);
  gridViewRef.current = gridView;
  const viewKey = `${role}|${viewVersion === null ? "latest" : String(viewVersion)}`;

  // Base grid + profiles + pipeline shapes.
  // Clear rows only on time-travel / role change — keep previous cells with an
  // inline loading indicator when a variable is added or a step is deleted
  // while staying on "latest". Shapes depend on steps + sources only: keep
  // them across version switches / variable changes.
  useEffect(() => {
    const gen = ++fetchGen.current;
    const alive = () => gen === fetchGen.current;
    // A page requested by an older generation no longer owns the lock (#250).
    setLoadingMore(false);
    const fail = (message: string | null) =>
      dispatch({ type: "SET_BENCH_ERROR", message });

    if (!workspace || !workspace.datasets.train.x.path) {
      setFrame(EMPTY_FRAME);
      setShapes({ shapes: [ZERO_SHAPE], stepErrors: new Map() });
      setLoading(false);
      prevViewKeyRef.current = null;
      prevStructureRef.current = null;
      fail(null);
      return;
    }

    const viewChanged = prevViewKeyRef.current !== viewKey;
    const structureChanged = prevStructureRef.current !== structureKey;
    prevViewKeyRef.current = viewKey;
    prevStructureRef.current = structureKey;

    // Stale cells for a different time-travel version must never flash.
    if (viewChanged) setFrame(EMPTY_FRAME);
    // An explicit reload (Retry, #246) refetches even a cached frame.
    const reloaded = prevTickRef.current !== tick;
    prevTickRef.current = tick;
    if (reloaded) frameCache.clear();
    loadErrorRef.current = false;
    const cacheKey = `${identityKey}|${gridKey}`;
    const cached = frameCache.get(cacheKey);
    if (cached && cached.structureKey === structureKey) {
      // Instant switch: nothing to ask the engine.
      setFrame(cached.frame);
      setShapes(cached.shapes);
      setLoading(false);
      fail(null);
      return;
    }
    const needShapes = structureChanged || shapesRef.current.length === 0;
    if (structureChanged) setShapes(NO_SHAPES);
    setLoading(true);

    const ws = workspace;
    const ver = version;
    const idKey = identityKey;
    const view = gridViewRef.current;

    void (async () => {
      try {
        const res = await fetchRowsPage(
          ws,
          role,
          ver,
          frameRef.current.columns.length,
          alive,
          view,
        );
        if (!alive()) return;
        const totalUnfiltered = res.total_unfiltered ?? res.total;
        setFrame((f) => ({
          ...f,
          columns: res.columns,
          rows: res.rows,
          total: res.total,
          totalUnfiltered,
          windowed: res.engine === "duckdb",
          rowsIdentity: idKey,
          rowsGridKey: gridViewKey(view),
        }));
        fail(null);
        // Unblock the grid as soon as rows arrive — do not wait on profiles.
        setLoading(false);

        if (totalUnfiltered === 0 && res.columns.length > 0) {
          void sourceMismatch(ws).then((msg) => {
            if (msg && alive()) {
              loadErrorRef.current = true;
              fail(msg);
            }
          });
        }

        // Profiles in the background so the grid can paint first (MAT-152).
        // Intersect with the just-fetched rows schema so a dropped / renamed
        // viewport column does not 422 the scoped call.
        const prefer = preferKnownColumns(
          visibleColsRef.current,
          res.columns.map((c) => c.name),
        );
        const wide = res.columns.length >= WIDE_COL_THRESHOLD;
        loadProfiles(
          ws,
          role,
          ver,
          wide && prefer.length > 0 ? prefer : null,
          res.columns.length,
          alive,
          (list, sample) =>
            setFrame((f) => ({
              ...f,
              profiles: new Map(list.map((p) => [p.name, p])),
              profilesIdentity: idKey,
              profileSample: sample,
            })),
          totalUnfiltered > PROFILE_SAMPLE_ROWS ? PROFILE_SAMPLE_ROWS : null,
        ).catch((e: unknown) => {
          // Keep rows usable; surface profile failure without clearing grid.
          if (alive()) {
            loadErrorRef.current = true;
            fail(errorText(e));
          }
        });

        if (!needShapes) return;
        const { rootError, ...next } = await fetchShapes(ws, role, ver, {
          rows: totalUnfiltered,
          cols: res.columns.length,
        });
        if (!alive()) return;
        setShapes(next);
        if (rootError) {
          loadErrorRef.current = true;
          fail(rootError);
        }
      } catch (e) {
        if (!alive()) return;
        setFrame(EMPTY_FRAME);
        fail(errorText(e));
        setLoading(false);
      }
    })();
  }, [
    workspace,
    role,
    version,
    identityKey,
    viewKey,
    structureKey,
    gridKey,
    tick,
    dispatch,
  ]);

  // Remember the frame on screen once rows, profiles and shapes are all in.
  useEffect(() => {
    if (
      frame.rowsIdentity === identityKey &&
      frame.profilesIdentity === identityKey &&
      frame.rowsGridKey === gridKey &&
      shapes.length > 0 &&
      isCacheable({
        rows: frame.rows.length,
        firstPageMax: Math.max(PAGE_DEFAULT, PAGE_WIDE),
        totalUnfiltered: frame.totalUnfiltered,
        hadError: loadErrorRef.current || stepErrors.size > 0,
      })
    ) {
      frameCache.set(`${identityKey}|${gridKey}`, {
        frame,
        shapes: { shapes, stepErrors },
        structureKey,
      });
    }
  }, [frame, shapes, stepErrors, identityKey, gridKey, structureKey]);

  const loadMore = useCallback(() => {
    if (!workspace || !workspace.datasets.train.x.path) return;
    if (loading || loadingMore) return;
    const { rows, columns, total } = frameRef.current;
    if (frameRef.current.windowed || rows.length >= total) return;
    const offset = rows.length;
    const gen = fetchGen.current;
    setLoadingMore(true);
    apiClient
      .workspaceRows(
        workspace,
        role,
        version,
        offset,
        rowsPageSize(columns.length),
        undefined,
        gridViewRef.current,
      )
      .then((more) => {
        if (gen !== fetchGen.current) return;
        setFrame((f) => ({
          ...f,
          // Avoid duplicating if a reload raced.
          rows: f.rows.length === offset ? [...f.rows, ...more.rows] : f.rows,
          total: more.total,
        }));
      })
      .catch((e: unknown) => {
        if (gen === fetchGen.current)
          dispatch({ type: "SET_BENCH_ERROR", message: errorText(e) });
      })
      .finally(() => {
        // Only the current generation releases the lock: a stale page must not
        // reopen it while the new generation loads (#250). A new generation
        // resets the lock itself, so a stale page never leaves it locked (#246).
        if (gen === fetchGen.current) setLoadingMore(false);
      });
  }, [workspace, role, version, loading, loadingMore, dispatch]);

  return {
    ...frame,
    shapes,
    stepErrors,
    loading,
    hasMore: !frame.windowed && frame.rows.length < frame.total,
    // The row count of the frame AND grid view on screen; null while they load
    // (never the previous view's count, datatoolkit-issues#110).
    shownTotal:
      frame.rowsIdentity === identityKey && frame.rowsGridKey === gridKey ? frame.total : null,
    version,
    isLatest,
    identity,
    loadMore,
    reload,
    reportVisibleColumns,
  };
}
