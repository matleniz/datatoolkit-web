/**
 * Workbench data layer (W2): fetches rows, profiles, and live preview from dtk-api.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  type EditorField,
} from "./schemaFields";

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
  reload: () => void;
  applyPending: () => void;
}

const WorkbenchDataContext = createContext<WorkbenchDataValue | null>(null);

function latestVersion(ws: Workspace): number {
  return ws.steps.length;
}

function effectiveVersion(ws: Workspace, viewVersion: number | null): number {
  const last = latestVersion(ws);
  if (viewVersion === null || viewVersion > last) return last;
  return viewVersion;
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

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const version = workspace ? effectiveVersion(workspace, viewVersion) : 0;
  const isLatest = workspace
    ? version === latestVersion(workspace)
    : true;

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
  useEffect(() => {
    if (!workspace || !workspace.datasets.train.x.path) {
      setColumns([]);
      setRows([]);
      setTotal(0);
      setProfiles(new Map());
      setShapes([{ rows: 0, cols: 0 }]);
      return;
    }
    let cancelled = false;
    const ws = workspace;

    (async () => {
      try {
        const [rowsRes, profRes] = await Promise.all([
          apiClient.workspaceRows(ws, role, version, 0, PAGE),
          apiClient.columnProfiles(ws, role, version),
        ]);
        if (cancelled) return;
        setColumns(rowsRes.columns);
        setRows(rowsRes.rows);
        setTotal(rowsRes.total);
        setProfiles(new Map(profRes.columns.map((p) => [p.name, p])));
        dispatch({ type: "SET_BENCH_ERROR", message: null });
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof EngineError ? e.message : String(e);
        dispatch({ type: "SET_BENCH_ERROR", message: msg });
      }

      // Shapes per version (raw + each step). limit=1 — engine rejects 0.
      const n = ws.steps.length;
      const nextShapes: PipelineShape[] = [];
      const errs = new Map<number, string>();
      for (let v = 0; v <= n; v++) {
        try {
          const r = await apiClient.workspaceRows(ws, role, v, 0, 1);
          if (cancelled) return;
          nextShapes.push({ rows: r.total, cols: r.columns.length });
        } catch (e) {
          if (cancelled) return;
          const msg =
            e instanceof EngineError ? e.message : String(e);
          // Failure at version v means step index v-1 failed.
          if (v > 0) errs.set(v - 1, msg);
          nextShapes.push(nextShapes[nextShapes.length - 1] ?? { rows: 0, cols: 0 });
          break;
        }
      }
      if (!cancelled) {
        setShapes(nextShapes);
        setStepErrors(errs);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspace, role, version, tick, dispatch]);

  // Schema for open editor op.
  useEffect(() => {
    if (!editor?.op) {
      setSchemaFields([]);
      return;
    }
    const op = resolveOp(editor.op);
    const openedParams = editor.params;
    let cancelled = false;
    setSchemaLoading(true);
    apiClient
      .transformSchema(op)
      .then((schema) => {
        if (cancelled) return;
        setSchemaFields(schemaToFields(schema, op));
        const defaults = defaultParams(schema, op);
        const merged: Record<string, unknown> = { ...defaults, ...openedParams };
        if (op === "drop_duplicates") {
          const keep = merged.keep ?? "none";
          if (
            (keep === "first" || keep === "last") &&
            (!merged.sort_by ||
              (Array.isArray(merged.sort_by) &&
                (merged.sort_by as unknown[]).length === 0))
          ) {
            const idCol = columns.find((c) => c.kind === "identifier");
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
    // Only re-fetch when the op changes (not on every param keystroke).
  }, [editor?.op, columns, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build pending step + live preview.
  const pendingStep = useMemo((): Step | null => {
    if (!editor?.op || !isLatest) return null;
    const uiOp = editor.op;
    const engineOp = resolveOp(uiOp);
    const params = toEngineParams(uiOp, editor.params);
    const check = stepParamsValid(engineOp, params, schemaFields);
    if (!check.ok) return null;
    return { op: engineOp, target: editor.target, params };
  }, [editor, isLatest, schemaFields]);

  useEffect(() => {
    if (!workspace || !pendingStep) {
      setPreview(null);
      setPreviewError(null);
      setNextRows(null);
      setNextColumns(null);
      return;
    }
    let cancelled = false;
    const ws = workspace;
    const step = pendingStep;

    (async () => {
      try {
        const prev = await apiClient.previewStep(ws, step, role);
        if (cancelled) return;
        setPreview(prev);
        setPreviewError(null);

        const withStep: Workspace = {
          ...ws,
          steps: [...ws.steps, step],
        };
        try {
          const after = await apiClient.workspaceRows(
            withStep,
            role,
            ws.steps.length + 1,
            0,
            PAGE,
          );
          if (cancelled) return;
          setNextRows(after.rows);
          setNextColumns(after.columns);
        } catch {
          if (!cancelled) {
            setNextRows(null);
            setNextColumns(null);
          }
        }
      } catch (e) {
        if (cancelled) return;
        setPreview(null);
        setNextRows(null);
        setNextColumns(null);
        setPreviewError(e instanceof EngineError ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspace, pendingStep, role]);

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
