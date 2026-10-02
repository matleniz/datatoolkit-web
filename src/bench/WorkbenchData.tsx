/**
 * Workbench data layer (W2): fetches rows, profiles, and live preview from dtk-api.
 * Composes the frame / editor-schema / preview hooks into one memoized context.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import type {
  ColumnProfile,
  PreviewStep,
  Step,
  WorkspaceRow,
  WorkspaceRowsColumn,
} from "../api/types";
import { isGridViewActive } from "../state/gridView";
import { useAppDispatch, useAppState } from "../state/AppStore";
import { buildDisplay, diffText, type DisplayFrame } from "./diff";
import type { EditorField } from "./schemaFields";
import type { DataIdentity } from "./dataIdentity";
import { useBenchFrame, type PipelineShape } from "./useBenchFrame";
import { editorBaseVersion } from "./version";
import { useEditorSchema } from "./useEditorSchema";
import { usePreview } from "./usePreview";

export type { PipelineShape };

export interface WorkbenchDataValue {
  version: number;
  isLatest: boolean;
  /**
   * The view shows the frame the editor's step applies to: the latest version
   * for a new step, the edited step's input version (datatoolkit-issues#10).
   */
  atEditBase: boolean;
  /**
   * Refresh identity of the viewed frame (role + effective version + steps
   * hash). Every consumer keys its fetches on `identity.key` (MAT-175).
   */
  identity: DataIdentity;
  /** Identity of the frame currently held in `rows` / `columns` (null = none). */
  rowsIdentity: string | null;
  /** Identity of the frame currently held in `profiles` (null = none). */
  profilesIdentity: string | null;
  columns: WorkspaceRowsColumn[];
  rows: WorkspaceRow[];
  /** Rows after the view-only filter (what the grid pages through). */
  total: number;
  /** Rows before the view-only filter. */
  totalUnfiltered: number;
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

export function WorkbenchDataProvider({ children }: { children: ReactNode }) {
  const { workspace, role, viewVersion, editor, gridView } = useAppState();
  const dispatch = useAppDispatch();

  const frame = useBenchFrame(workspace, role, viewVersion, dispatch, gridView);
  const { isLatest, columns, rows } = frame;
  const editIndex = editor?.editIndex;
  const atBase = workspace
    ? frame.version === editorBaseVersion(workspace, editIndex)
    : isLatest;
  const schema = useEditorSchema(editor, columns, dispatch);
  const pv = usePreview({
    workspace,
    role,
    editor,
    atBase,
    columns,
    profiles: frame.profiles,
    schemaFields: schema.schemaFields,
    schemaLoading: schema.schemaLoading,
    schemaError: schema.schemaError,
  });
  const { preview, nextRows, nextColumns, pendingStep } = pv;

  // A step preview diffs the unfiltered frame: skip it under a view-only filter.
  const diffable = atBase && !isGridViewActive(gridView);
  const display = useMemo(
    () =>
      buildDisplay(
        columns,
        rows,
        diffable ? preview : null,
        diffable ? nextRows : null,
        diffable ? nextColumns : null,
      ),
    [columns, rows, preview, nextRows, nextColumns, diffable],
  );

  const applyPending = useCallback(() => {
    if (!pendingStep) return;
    if (editIndex === undefined) dispatch({ type: "ADD_STEP", step: pendingStep });
    else dispatch({ type: "REPLACE_STEP", index: editIndex, step: pendingStep });
  }, [pendingStep, editIndex, dispatch]);

  const value = useMemo<WorkbenchDataValue>(
    () => ({
      version: frame.version,
      isLatest,
      atEditBase: atBase,
      identity: frame.identity,
      rowsIdentity: frame.rowsIdentity,
      profilesIdentity: frame.profilesIdentity,
      columns,
      rows,
      total: frame.total,
      totalUnfiltered: frame.totalUnfiltered,
      profiles: frame.profiles,
      display,
      preview: atBase ? preview : null,
      previewError: pv.previewError,
      pendingStep: atBase ? pendingStep : null,
      pendingDiffText: diffText(display.diff),
      shapes: frame.shapes,
      stepErrors: frame.stepErrors,
      transforms: schema.transforms,
      schemaFields: schema.schemaFields,
      schemaLoading: schema.schemaLoading,
      schemaError: schema.schemaError,
      editorBlocker: pv.editorBlocker,
      loading: frame.loading,
      previewLoading: pv.previewLoading,
      hasMore: frame.hasMore,
      loadMore: frame.loadMore,
      reload: frame.reload,
      applyPending,
      reportVisibleColumns: frame.reportVisibleColumns,
    }),
    [
      frame,
      schema,
      pv,
      columns,
      rows,
      isLatest,
      atBase,
      preview,
      pendingStep,
      display,
      applyPending,
    ],
  );

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
