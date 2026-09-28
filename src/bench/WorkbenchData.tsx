/**
 * Workbench data layer (W2): fetches rows, profiles, and live preview from dtk-api.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { apiClient } from "../api/client";
import { EngineError } from "../api/types";
import type {
  ColumnProfile,
  PreviewStep,
  Step,
  Workspace,
  WorkspaceRow,
  WorkspaceRowsColumn,
} from "../api/types";
import { useAppDispatch, useAppState } from "../state/AppStore";
import { buildDisplay, diffText, type DisplayFrame } from "./diff";
import { resolveOp, toEngineParams } from "./presets";
import {
  defaultParams,
  schemaFieldsGap,
  schemaToFields,
  stepEditorBlockers,
  stepParamsValid,
  stripNullParams,
  type EditorField,
} from "./schemaFields";
import {
  PAGE_DEFAULT,
  rowsPageSize,
  WIDE_COL_THRESHOLD,
} from "./grid/columnWindow";
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

export interface WorkbenchDataValue {
  version: number;
  isLatest: boolean;
  columns: WorkspaceRowsColumn[];
  rows: WorkspaceRow[];
  total: number;
  profiles: Map<string, ColumnProfile>;
  display: DisplayFrame;
  preview: PreviewStep | null;
  previewError: string | null;
  pendingStep: Step | null;
  pendingDiffText: string;
  shapes: PipelineShape[];
  stepErrors: Map<number, string>;
  transforms: { op: string; title: string; description: string }[];
  schemaFields: EditorField[];
  schemaLoading: boolean;
  /** Schema fetch / mapping failure — never silently clear when pendingStep is null. */
  schemaError: string | null;
  /** Front-side Apply blockers (duplicate step, column already gone). */
  editorBlocker: string | null;
  loading: boolean;
  /** True while a live preview request is in flight for the pending step. */
  previewLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  applyPending: () => void;
  /**
   * Grid reports horizontally visible column names so profiles can prefer
   * them first when the engine supports a `columns` filter (MAT-152).
   */
  reportVisibleColumns: (names: string[]) => void;
}

const WorkbenchDataContext = createContext<WorkbenchDataValue | null>(null);

function stepKey(step: Step | null): string | null {
  if (!step) return null;
  return JSON.stringify({
    op: step.op,
    target: step.target,
    params: step.params,
    align: step.align ?? false,
  });
}

export function WorkbenchDataProvider({ children }: { children: ReactNode }) {
  const { workspace, role, viewVersion, editor } = useAppState();
  const dispatch = useAppDispatch();

  const [columns, setColumns] = useState<WorkspaceRowsColumn[]>([]);
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [profiles, setProfiles] = useState<Map<string, ColumnProfile>>(
    new Map(),
  );
  const [preview, setPreview] = useState<PreviewStep | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [nextRows, setNextRows] = useState<WorkspaceRow[] | null>(null);
  const [nextColumns, setNextColumns] = useState<WorkspaceRowsColumn[] | null>(
    null,
  );
  const [shapes, setShapes] = useState<PipelineShape[]>([]);
  const [stepErrors, setStepErrors] = useState<Map<number, string>>(new Map());
  const [transforms, setTransforms] = useState<
    { op: string; title: string; description: string }[]
  >([]);
  const [schemaFields, setSchemaFields] = useState<EditorField[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [visibleColumnNames, setVisibleColumnNames] = useState<string[]>([]);

  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const visibleColsRef = useRef<string[]>([]);
  visibleColsRef.current = visibleColumnNames;
  const fetchGen = useRef(0);
  const prevViewKeyRef = useRef<string | null>(null);
  const prevStructureRef = useRef<string | null>(null);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const reportVisibleColumns = useCallback((names: string[]) => {
    setVisibleColumnNames((prev) => {
      if (
        prev.length === names.length &&
        prev.every((n, i) => n === names[i])
      ) {
        return prev;
      }
      return names;
    });
  }, []);

  const version = workspace ? effectiveVersion(workspace, viewVersion) : 0;
  const isLatest = workspace
    ? version === latestVersion(workspace)
    : true;
  const structureKey = shapesStructureKey(workspace, role);
  /** Time-travel / role identity — not the effective version number (delete/add keep "latest"). */
  const viewKey = `${role}|${viewVersion === null ? "latest" : String(viewVersion)}`;

  // Load transform catalogue once.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .listTransforms()
      .then((list) => {
        if (!cancelled) {
          setTransforms(
            list.map((t) => ({
              op: t.op,
              title: t.title,
              description: t.description,
            })),
          );
        }
      })
      .catch(() => {
        /* picker still works from OP_STAGE */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Base grid + profiles + pipeline shapes.
  // Clear rows only on time-travel / role change — keep previous cells with an
  // inline loading indicator when a variable is added or a step is deleted
  // while staying on "latest". Shapes depend on steps + sources only: keep
  // them across version switches / variable changes.
  useEffect(() => {
    const gen = ++fetchGen.current;

    if (!workspace || !workspace.datasets.train.x.path) {
      setColumns([]);
      setRows([]);
      setTotal(0);
      setProfiles(new Map());
      setShapes([{ rows: 0, cols: 0 }]);
      setStepErrors(new Map());
      setLoading(false);
      prevViewKeyRef.current = null;
      prevStructureRef.current = null;
      dispatch({ type: "SET_BENCH_ERROR", message: null });
      return;
    }

    const viewChanged = prevViewKeyRef.current !== viewKey;
    const structureChanged = prevStructureRef.current !== structureKey;
    prevViewKeyRef.current = viewKey;
    prevStructureRef.current = structureKey;

    // Stale cells for a different time-travel version must never flash.
    if (viewChanged) {
      setColumns([]);
      setRows([]);
      setTotal(0);
      setProfiles(new Map());
    }

    const needShapes =
      structureChanged || shapesRef.current.length === 0;
    if (structureChanged) {
      setShapes([]);
      setStepErrors(new Map());
    }

    setLoading(true);

    const ws = workspace;
    const n = ws.steps.length;
    const ver = version;

    (async () => {
      // Shapes: reuse the main rows page for the viewed version; only hit
      // limit=1 for other pipeline versions (avoids a duplicate rows call on
      // open when steps.length === 0).
      let rawShapeError: string | null = null;

      try {
        // Peek column count so wide frames use a smaller first page (MAT-152).
        // limit=1 still returns full column metadata without a 6MB body.
        const peek = await apiClient.workspaceRows(ws, role, ver, 0, 1);
        if (gen !== fetchGen.current) return;
        const page = rowsPageSize(peek.columns.length);
        const rowsRes =
          page <= 1
            ? peek
            : await apiClient.workspaceRows(ws, role, ver, 0, page);
        if (gen !== fetchGen.current) return;

        setColumns(rowsRes.columns);
        setRows(rowsRes.rows);
        setTotal(rowsRes.total);
        dispatch({ type: "SET_BENCH_ERROR", message: null });
        // Unblock the grid as soon as rows arrive — do not wait on profiles.
        if (gen === fetchGen.current) setLoading(false);

        // MAT-167: legacy wrong-kind specs can "succeed" with 0 rows and
        // garbage columns (nested JSON read as csv). Surface the mismatch
        // instead of a silent empty grid; never block the empty-state paint.
        if (rowsRes.total === 0 && rowsRes.columns.length > 0) {
          const trainPath = ws.datasets.train.x.path;
          const storedKind = ws.datasets.train.x.kind;
          void (async () => {
            try {
              const inspect = await apiClient.runKey("file_inspect", {
                path: trainPath,
              });
              const raw = inspect.metrics?.load_spec;
              if (typeof raw !== "string" || !raw) return;
              const parsed = JSON.parse(raw) as {
                kind?: string;
                record_path?: string;
              };
              if (!parsed.kind || parsed.kind === storedKind) return;
              if (gen !== fetchGen.current) return;
              const extra =
                parsed.kind === "json" && parsed.record_path
                  ? ` (record_path ${JSON.stringify(parsed.record_path)})`
                  : "";
              dispatch({
                type: "SET_BENCH_ERROR",
                message: `Stored train source failed to parse: saved as ${storedKind} but file_inspect detects ${parsed.kind}${extra}. Re-inspect the file on Sources.`,
              });
            } catch {
              /* empty-state already visible */
            }
          })();
        }

        // Profiles in the background so the grid can paint first (MAT-152).
        // When `columns` is supported by the engine, we profile the viewport
        // first then fill the rest; today's engine ignores the filter and
        // returns every column in one shot (no second round-trip).
        // Intersect with the just-fetched rows schema so a dropped / renamed
        // viewport column (or other role) does not 422 the scoped call.
        const prefer = preferKnownColumns(
          visibleColsRef.current,
          rowsRes.columns.map((c) => c.name),
        );
        const wide = rowsRes.columns.length >= WIDE_COL_THRESHOLD;
        void (async () => {
          try {
            const firstCols =
              wide && prefer.length > 0 ? prefer : null;
            let firstRaw: Awaited<
              ReturnType<typeof apiClient.columnProfiles>
            >;
            let scopedOk = false;
            if (firstCols) {
              try {
                firstRaw = await apiClient.columnProfiles(
                  ws,
                  role,
                  ver,
                  firstCols,
                );
                scopedOk = true;
              } catch (e) {
                // Residual stale names (or race): fall back to unscoped
                // instead of SET_BENCH_ERROR when the engine rejects unknowns.
                if (!(e instanceof EngineError) || e.status !== 422) {
                  throw e;
                }
                firstRaw = await apiClient.columnProfiles(ws, role, ver);
              }
            } else {
              firstRaw = await apiClient.columnProfiles(ws, role, ver);
            }
            if (gen !== fetchGen.current) return;
            const first = normalizeProfiles(firstRaw);
            setProfiles(new Map(first.columns.map((p) => [p.name, p])));
            if (
              scopedOk &&
              firstCols &&
              first.columns.length < rowsRes.columns.length
            ) {
              const restRaw = await apiClient.columnProfiles(ws, role, ver);
              if (gen !== fetchGen.current) return;
              const rest = normalizeProfiles(restRaw);
              setProfiles(new Map(rest.columns.map((p) => [p.name, p])));
            }
          } catch (e) {
            if (gen !== fetchGen.current) return;
            // Keep rows usable; surface profile failure without clearing grid.
            const msg = e instanceof EngineError ? e.message : String(e);
            dispatch({ type: "SET_BENCH_ERROR", message: msg });
          }
        })();

        if (needShapes) {
          const nextShapes: PipelineShape[] = new Array(n + 1);
          const errs = new Map<number, string>();
          nextShapes[ver] = {
            rows: rowsRes.total,
            cols: rowsRes.columns.length,
          };
          if (n === 0) {
            setShapes([{ rows: rowsRes.total, cols: rowsRes.columns.length }]);
            setStepErrors(new Map());
          } else {
            for (let v = 0; v <= n; v++) {
              if (v === ver) continue;
              if (gen !== fetchGen.current) return;
              try {
                const r = await apiClient.workspaceRows(ws, role, v, 0, 1);
                nextShapes[v] = { rows: r.total, cols: r.columns.length };
              } catch (e) {
                const msg =
                  e instanceof EngineError ? e.message : String(e);
                if (v > 0) errs.set(v - 1, msg);
                if (v === 0) {
                  rawShapeError = msg;
                  dispatch({ type: "SET_BENCH_ERROR", message: msg });
                }
                nextShapes[v] =
                  nextShapes[v - 1] ?? { rows: 0, cols: 0 };
                // Fill remaining with last known so the bar stays sized.
                for (let u = v + 1; u <= n; u++) {
                  if (!nextShapes[u]) nextShapes[u] = nextShapes[v]!;
                }
                break;
              }
              if (gen === fetchGen.current) {
                setShapes(
                  nextShapes.map(
                    (s, i) =>
                      s ??
                      nextShapes[ver] ??
                      nextShapes[i - 1] ?? { rows: 0, cols: 0 },
                  ),
                );
                setStepErrors(new Map(errs));
              }
            }
            if (gen === fetchGen.current) {
              setShapes(
                nextShapes.map(
                  (s, i) =>
                    s ??
                    nextShapes[ver] ??
                    nextShapes[i - 1] ?? { rows: 0, cols: 0 },
                ),
              );
              setStepErrors(new Map(errs));
            }
          }
        }
      } catch (e) {
        if (gen !== fetchGen.current) return;
        const msg = e instanceof EngineError ? e.message : String(e);
        setColumns([]);
        setRows([]);
        setTotal(0);
        setProfiles(new Map());
        dispatch({ type: "SET_BENCH_ERROR", message: msg });
        if (needShapes && ver === 0) {
          rawShapeError = msg;
        }
        if (gen === fetchGen.current) setLoading(false);
      }

      if (rawShapeError && gen === fetchGen.current) {
        dispatch({ type: "SET_BENCH_ERROR", message: rawShapeError });
      }
    })();
  }, [workspace, role, version, viewKey, structureKey, tick, dispatch]);

  const hasMore = rows.length < total;

  const loadMore = useCallback(() => {
    if (!workspace || !workspace.datasets.train.x.path) return;
    if (loading || loadingMore) return;
    if (rowsRef.current.length >= total) return;
    const ws = workspace;
    const offset = rowsRef.current.length;
    const ver = version;
    const page = rowsPageSize(columnsRef.current.length);
    setLoadingMore(true);
    const gen = fetchGen.current;
    void (async () => {
      try {
        const more = await apiClient.workspaceRows(
          ws,
          role,
          ver,
          offset,
          page,
        );
        if (gen !== fetchGen.current) return;
        setRows((prev) => {
          // Avoid duplicating if a reload raced.
          if (prev.length !== offset) return prev;
          return [...prev, ...more.rows];
        });
        setTotal(more.total);
      } catch (e) {
        if (gen !== fetchGen.current) return;
        const msg = e instanceof EngineError ? e.message : String(e);
        dispatch({ type: "SET_BENCH_ERROR", message: msg });
      } finally {
        if (gen === fetchGen.current) setLoadingMore(false);
      }
    })();
  }, [workspace, role, version, total, loading, loadingMore, dispatch]);

  // Schema for open editor op — depend only on op (not columns) to avoid
  // cancelling the fetch when the grid reloads after Apply.
  useEffect(() => {
    if (!editor?.op) {
      setSchemaFields([]);
      setSchemaLoading(false);
      setSchemaError(null);
      return;
    }
    const op = resolveOp(editor.op);
    const openedParams = editor.params;
    let cancelled = false;
    setSchemaFields([]);
    setSchemaLoading(true);
    setSchemaError(null);
    apiClient
      .transformSchema(op)
      .then((schema) => {
        if (cancelled) return;
        const fields = schemaToFields(schema, op);
        const gap = schemaFieldsGap(schema, fields);
        setSchemaFields(fields);
        setSchemaError(gap);
        const defaults = defaultParams(schema, op);
        const opened = toEngineParams(op, openedParams);
        const merged: Record<string, unknown> = {
          ...defaults,
          ...opened,
        };
        if (op === "drop_duplicates") {
          const keep = merged.keep ?? "none";
          if (
            (keep === "first" || keep === "last") &&
            (!merged.sort_by ||
              (Array.isArray(merged.sort_by) &&
                (merged.sort_by as unknown[]).length === 0))
          ) {
            const idCol = columnsRef.current.find(
              (c) => c.kind === "identifier",
            );
            if (idCol) merged.sort_by = [idCol.name];
            else {
              merged.keep = "none";
              merged.sort_by = null;
            }
          }
        }
        dispatch({ type: "SET_EDITOR_PARAMS", params: merged });
      })
      .catch((e) => {
        if (!cancelled) {
          setSchemaFields([]);
          setSchemaError(
            e instanceof EngineError ? e.message : String(e),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSchemaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editor?.op, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const editorBlocker = useMemo((): string | null => {
    if (!editor?.op || !isLatest) return null;
    if (schemaLoading || schemaError) return null;
    const engineOp = resolveOp(editor.op);
    const params = stripNullParams(toEngineParams(editor.op, editor.params));
    const prev = workspace?.steps.length
      ? workspace.steps[workspace.steps.length - 1]!
      : null;
    const missingByColumn = new Map<string, number>();
    for (const [name, pr] of profiles) {
      missingByColumn.set(name, pr.missing);
    }
    return stepEditorBlockers(engineOp, params, editor.target, {
      availableColumns: columns.map((c) => c.name),
      previousStep: prev
        ? { op: prev.op, target: prev.target, params: prev.params }
        : null,
      missingByColumn,
    });
  }, [
    editor,
    isLatest,
    schemaLoading,
    schemaError,
    columns,
    profiles,
    workspace?.steps,
  ]);

  // Build pending step + live preview.
  const pendingStep = useMemo((): Step | null => {
    if (!editor?.op || !isLatest) return null;
    // Wait for schema→fields; never preview while schema is broken/empty for
    // a param-bearing op (schemaError covers required-field gaps — MAT-177).
    if (schemaLoading || schemaError) return null;
    if (editorBlocker) return null;
    const uiOp = editor.op;
    const engineOp = resolveOp(uiOp);
    let editorParams = editor.params;
    if (
      engineOp === "formula" &&
      (!editorParams.variables ||
        (editorParams.variables as unknown[]).length === 0) &&
      workspace?.variables &&
      workspace.variables.length > 0
    ) {
      editorParams = { ...editorParams, variables: workspace.variables };
    }
    const params = stripNullParams(toEngineParams(uiOp, editorParams));
    const check = stepParamsValid(engineOp, params, schemaFields);
    if (!check.ok) return null;
    return { op: engineOp, target: editor.target, params };
  }, [
    editor,
    isLatest,
    schemaFields,
    schemaLoading,
    schemaError,
    editorBlocker,
    workspace?.variables,
  ]);

  const pendingStepKey = stepKey(pendingStep);

  useEffect(() => {
    if (!workspace || !pendingStep || !pendingStepKey) {
      setPreview(null);
      setPreviewError(null);
      setNextRows(null);
      setNextColumns(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const ws = workspace;
    const step = pendingStep;
    setPreviewLoading(true);

    (async () => {
      try {
        const prev = await apiClient.previewStep(ws, step, role);
        if (cancelled) return;
        setPreview(prev);
        setPreviewError(null);

        // preview_step only returns diffs — fetch the after-frame and merge by _rid.
        const withStep: Workspace = {
          ...ws,
          steps: [...ws.steps, step],
        };
        try {
          const after = await apiClient.workspaceRows(
            withStep,
            role,
            withStep.steps.length,
            0,
            rowsPageSize(columnsRef.current.length) || PAGE_DEFAULT,
          );
          if (cancelled) return;
          setNextRows(after.rows);
          setNextColumns(after.columns);
        } catch (e) {
          if (!cancelled) {
            setNextRows(null);
            setNextColumns(null);
            setPreviewError(
              e instanceof EngineError
                ? e.message
                : `Preview rows failed: ${String(e)}`,
            );
          }
        }
      } catch (e) {
        if (cancelled) return;
        setPreview(null);
        setNextRows(null);
        setNextColumns(null);
        setPreviewError(e instanceof EngineError ? e.message : String(e));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // pendingStepKey stabilises object-identity churn from useMemo.
  }, [workspace, pendingStepKey, role]); // eslint-disable-line react-hooks/exhaustive-deps

  const display = useMemo(
    () =>
      buildDisplay(
        columns,
        rows,
        isLatest ? preview : null,
        isLatest ? nextRows : null,
        isLatest ? nextColumns : null,
      ),
    [columns, rows, preview, nextRows, nextColumns, isLatest],
  );

  const applyPending = useCallback(() => {
    if (!pendingStep) return;
    dispatch({ type: "ADD_STEP", step: pendingStep });
  }, [pendingStep, dispatch]);

  const value: WorkbenchDataValue = {
    version,
    isLatest,
    columns,
    rows,
    total,
    profiles,
    display,
    preview: isLatest ? preview : null,
    previewError,
    pendingStep: isLatest ? pendingStep : null,
    pendingDiffText: diffText(display.diff),
    shapes,
    stepErrors,
    transforms,
    schemaFields,
    schemaLoading,
    schemaError,
    editorBlocker,
    loading,
    previewLoading,
    hasMore,
    loadMore,
    reload,
    applyPending,
    reportVisibleColumns,
  };

  return (
    <WorkbenchDataContext.Provider value={value}>
      {children}
    </WorkbenchDataContext.Provider>
  );
}

export function useWorkbenchData(): WorkbenchDataValue {
  const ctx = useContext(WorkbenchDataContext);
  if (!ctx) {
    throw new Error("useWorkbenchData requires WorkbenchDataProvider");
  }
  return ctx;
}
