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
  schemaToFields,
  stepParamsValid,
  stripNullParams,
  type EditorField,
} from "./schemaFields";
import {
  effectiveVersion,
  latestVersion,
  normalizeProfiles,
  shapesStructureKey,
} from "./version";

const PAGE = 500;

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
  loading: boolean;
  /** True while a live preview request is in flight for the pending step. */
  previewLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  applyPending: () => void;
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
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const fetchGen = useRef(0);
  const prevViewKeyRef = useRef<string | null>(null);
  const prevStructureRef = useRef<string | null>(null);

  const reload = useCallback(() => setTick((t) => t + 1), []);

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
      // Shapes (limit=1) start in parallel with the page of rows + profiles so
      // the raw node shows dimensions immediately on large datasets.
      // Step versions stay sequential: stop at the first failing step.
      let rawShapeError: string | null = null;
      const shapesTask = needShapes
        ? (async () => {
            const nextShapes: PipelineShape[] = [];
            const errs = new Map<number, string>();
            for (let v = 0; v <= n; v++) {
              if (gen !== fetchGen.current) return;
              try {
                const r = await apiClient.workspaceRows(ws, role, v, 0, 1);
                nextShapes.push({ rows: r.total, cols: r.columns.length });
                // Publish progressively so "raw" is not stuck on "—" while later
                // step shapes (or the big rows page) are still in flight.
                if (gen === fetchGen.current) {
                  setShapes([...nextShapes]);
                  setStepErrors(new Map(errs));
                }
              } catch (e) {
                const msg =
                  e instanceof EngineError ? e.message : String(e);
                if (v > 0) errs.set(v - 1, msg);
                if (v === 0) {
                  rawShapeError = msg;
                  if (gen === fetchGen.current) {
                    dispatch({ type: "SET_BENCH_ERROR", message: msg });
                  }
                }
                nextShapes.push(
                  nextShapes[nextShapes.length - 1] ?? { rows: 0, cols: 0 },
                );
                if (gen === fetchGen.current) {
                  setShapes([...nextShapes]);
                  setStepErrors(new Map(errs));
                }
                break;
              }
            }
          })()
        : Promise.resolve();

      try {
        const [rowsRes, profRaw] = await Promise.all([
          apiClient.workspaceRows(ws, role, ver, 0, PAGE),
          apiClient.columnProfiles(ws, role, ver),
        ]);
        if (gen !== fetchGen.current) return;
        const profRes = normalizeProfiles(profRaw);
        setColumns(rowsRes.columns);
        setRows(rowsRes.rows);
        setTotal(rowsRes.total);
        setProfiles(new Map(profRes.columns.map((p) => [p.name, p])));
        // Do not clear a concurrent raw-shape failure.
        if (!rawShapeError) {
          dispatch({ type: "SET_BENCH_ERROR", message: null });
        }
      } catch (e) {
        if (gen !== fetchGen.current) return;
        const msg = e instanceof EngineError ? e.message : String(e);
        setColumns([]);
        setRows([]);
        setTotal(0);
        setProfiles(new Map());
        dispatch({ type: "SET_BENCH_ERROR", message: msg });
      } finally {
        if (gen === fetchGen.current) setLoading(false);
      }

      await shapesTask;
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
    setLoadingMore(true);
    const gen = fetchGen.current;
    void (async () => {
      try {
        const more = await apiClient.workspaceRows(
          ws,
          role,
          ver,
          offset,
          PAGE,
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
      return;
    }
    const op = resolveOp(editor.op);
    const openedParams = editor.params;
    let cancelled = false;
    setSchemaFields([]);
    setSchemaLoading(true);
    apiClient
      .transformSchema(op)
      .then((schema) => {
        if (cancelled) return;
        const fields = schemaToFields(schema, op);
        setSchemaFields(fields);
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
          setPreviewError(
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

  // Build pending step + live preview.
  const pendingStep = useMemo((): Step | null => {
    if (!editor?.op || !isLatest) return null;
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
    // Wait for schema→fields so the editor never previews with an empty form.
    if (schemaLoading || schemaFields.length === 0) return null;
    return { op: engineOp, target: editor.target, params };
  }, [editor, isLatest, schemaFields, schemaLoading, workspace?.variables]);

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
            PAGE,
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
    loading,
    previewLoading,
    hasMore,
    loadMore,
    reload,
    applyPending,
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
