/**
 * Editor → pending step → live preview (diff + after-frame) of that step.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { apiClient } from "../api/client";
import {
  EngineError,
  errorText,
  type ColumnProfile,
  type PreviewStep,
  type Role,
  type Step,
  type Workspace,
  type WorkspaceRow,
  type WorkspaceRowsColumn,
} from "../api/types";
import { useDebounced } from "../hooks";
import type { EditorState } from "../state/reducer";
import { PAGE_DEFAULT, rowsPageSize } from "./grid/columnWindow";
import { resolveOp, toEngineParams } from "./presets";
import {
  coerceImputeFillValue,
  dropInactiveParams,
  stepEditorBlockers,
  stepParamsValid,
  stripNullParams,
  type EditorField,
} from "./schemaFields";

// Same debounce as dock params — avoid previewStep+rows on every keystroke.
const PREVIEW_DEBOUNCE_MS = 300;

interface PreviewState {
  preview: PreviewStep | null;
  nextRows: WorkspaceRow[] | null;
  nextColumns: WorkspaceRowsColumn[] | null;
  error: string | null;
  loading: boolean;
}

const IDLE: PreviewState = {
  preview: null,
  nextRows: null,
  nextColumns: null,
  error: null,
  loading: false,
};

function stepKey(step: Step | null): string | null {
  if (!step) return null;
  return JSON.stringify({
    op: step.op,
    target: step.target,
    params: step.params,
    align: step.align ?? false,
  });
}

/** Editor params → step params: params whose `x-dtk-when` fails are not sent. */
function engineParams(
  op: string,
  params: Record<string, unknown>,
  columns: WorkspaceRowsColumn[],
  fields: EditorField[],
) {
  const active = dropInactiveParams(toEngineParams(op, params), fields);
  return stripNullParams(coerceImputeFillValue(active, columns));
}

/** preview_step only returns diffs — fetch the after-frame and merge by _rid. */
async function fetchPreview(
  ws: Workspace,
  step: Step,
  role: Role,
  columnCount: number,
  signal: AbortSignal,
): Promise<Omit<PreviewState, "loading">> {
  let preview: PreviewStep;
  try {
    preview = await apiClient.previewStep(ws, step, role, signal);
  } catch (e) {
    return { ...IDLE, error: errorText(e) };
  }
  const withStep: Workspace = { ...ws, steps: [...ws.steps, step] };
  try {
    const after = await apiClient.workspaceRows(
      withStep,
      role,
      withStep.steps.length,
      0,
      rowsPageSize(columnCount) || PAGE_DEFAULT,
      signal,
    );
    return {
      preview,
      nextRows: after.rows,
      nextColumns: after.columns,
      error: null,
    };
  } catch (e) {
    const error =
      e instanceof EngineError
        ? e.message
        : `Preview rows failed: ${String(e)}`;
    return { ...IDLE, preview, error };
  }
}

interface PreviewInput {
  workspace: Workspace | null;
  role: Role;
  editor: EditorState | null;
  isLatest: boolean;
  columns: WorkspaceRowsColumn[];
  profiles: Map<string, ColumnProfile>;
  schemaFields: EditorField[];
  schemaLoading: boolean;
  schemaError: string | null;
}

export function usePreview(input: PreviewInput) {
  const {
    workspace,
    role,
    editor,
    isLatest,
    columns,
    profiles,
    schemaFields,
    schemaLoading,
    schemaError,
  } = input;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const editorBlocker = useMemo((): string | null => {
    if (!editor?.op || !isLatest) return null;
    if (schemaLoading || schemaError) return null;
    const steps = workspace?.steps ?? [];
    const prev = steps[steps.length - 1];
    return stepEditorBlockers(
      resolveOp(editor.op),
      engineParams(editor.op, editor.params, columns, schemaFields),
      editor.target,
      {
        availableColumns: columns.map((c) => c.name),
        previousStep: prev
          ? { op: prev.op, target: prev.target, params: prev.params }
          : null,
        missingByColumn: new Map(
          [...profiles].map(([name, p]) => [name, p.missing]),
        ),
      },
    );
  }, [
    editor,
    isLatest,
    schemaLoading,
    schemaError,
    schemaFields,
    columns,
    profiles,
    workspace?.steps,
  ]);

  const variables = workspace?.variables;
  const pendingStep = useMemo((): Step | null => {
    if (!editor?.op || !isLatest) return null;
    // Wait for schema→fields; never preview while schema is broken/empty for
    // a param-bearing op (schemaError covers required-field gaps — MAT-177).
    if (schemaLoading || schemaError || editorBlocker) return null;
    const engineOp = resolveOp(editor.op);
    let params = editor.params;
    if (
      engineOp === "formula" &&
      !(params.variables as unknown[] | undefined)?.length &&
      variables?.length
    ) {
      params = { ...params, variables };
    }
    const engine = engineParams(editor.op, params, columns, schemaFields);
    if (!stepParamsValid(engineOp, engine, schemaFields).ok) return null;
    return { op: engineOp, target: editor.target, params: engine };
  }, [
    editor,
    isLatest,
    columns,
    schemaFields,
    schemaLoading,
    schemaError,
    editorBlocker,
    variables,
  ]);

  const [state, setState] = useState<PreviewState>(IDLE);
  const pendingKey = stepKey(pendingStep);
  const debouncedKey = useDebounced(pendingKey, PREVIEW_DEBOUNCE_MS);
  const pendingRef = useRef({ step: pendingStep, key: pendingKey });
  pendingRef.current = { step: pendingStep, key: pendingKey };

  const idle = !workspace || !pendingKey;
  useEffect(() => {
    if (idle) setState(IDLE);
  }, [idle]);

  // Runs once the key has stopped changing; the cleanup aborts the superseded
  // request so a stale preview never lands.
  useEffect(() => {
    const { step, key } = pendingRef.current;
    if (!workspace || !step || key !== debouncedKey) return;
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    void fetchPreview(
      workspace,
      step,
      role,
      columnsRef.current.length,
      ac.signal,
    ).then((res) => {
      if (!ac.signal.aborted) setState({ ...res, loading: false });
    });
    return () => ac.abort();
  }, [workspace, role, debouncedKey]);

  return {
    editorBlocker,
    pendingStep,
    preview: state.preview,
    previewError: state.error,
    previewLoading: state.loading,
    nextRows: state.nextRows,
    nextColumns: state.nextColumns,
  };
}
