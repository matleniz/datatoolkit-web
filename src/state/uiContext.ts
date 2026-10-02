import { dataIdentity } from "../bench/dataIdentity";
import { PER_COLUMN_PARAM_TOOLS, toolParamsKey } from "../bench/left/keyTunable";
import { effectiveVersion } from "../bench/version";
import type { GridFilter, GridSortKey } from "./gridView";
import type { AppState } from "./reducer";

/**
 * What Studio publishes to the engine's UI bridge (`PUT /api/ui/context`,
 * AGENT-BRIDGE.md "UI-context protocol"): small, no row values.
 */
export interface UiContext {
  session: string;
  screen: string;
  workspace: string | null;
  role: string;
  /** Effective version (viewVersion resolved). */
  version: number;
  /** steps.length */
  latest: number;
  /** `DataIdentity.key` of the frame on screen. */
  identity: string;
  selection: {
    columns: string[];
    row: number | null;
    cell: { rid: number; col: string } | null;
  };
  windows: { tool: string; params: Record<string, unknown> }[];
  editor: {
    op: string | null;
    index: number | null;
    params: Record<string, unknown>;
  } | null;
  /** The view-only filter / sort of the grid and the rows it shows (null while loading). */
  grid: { filter: GridFilter | null; sort: GridSortKey[]; total: number | null };
}

/** Identity key of the frame `state` shows (the agent's `base_identity`). */
export function currentIdentityKey(
  state: Pick<AppState, "workspace" | "role" | "viewVersion">,
): string {
  const ws = state.workspace;
  return dataIdentity(
    ws,
    state.role,
    ws ? effectiveVersion(ws, state.viewVersion) : null,
  ).key;
}

/** Open dock windows with their persisted params (`column` / `by` merged in). */
function windowsOf(state: UiContextState): UiContext["windows"] {
  const focus = state.selection.columns[0] ?? state.selection.cell?.col ?? null;
  return state.dock.tools.map((tool) => {
    const perColumn = PER_COLUMN_PARAM_TOOLS.has(tool) && focus !== null;
    const params: Record<string, unknown> = {
      ...state.toolParams[toolParamsKey(tool, perColumn ? focus : null)],
    };
    if (perColumn) params.column = focus;
    if (tool === "dist" && state.distBy) params.by = state.distBy;
    return { tool, params };
  });
}

/** The slice of state the context is built from (the publisher's deps). */
export type UiContextState = Pick<
  AppState,
  | "workspace"
  | "screen"
  | "role"
  | "viewVersion"
  | "selection"
  | "editor"
  | "dock"
  | "toolParams"
  | "distBy"
  | "gridView"
  | "gridTotal"
>;

export function buildUiContext(
  state: UiContextState,
  session: string,
): UiContext {
  const ws = state.workspace;
  const version = ws ? effectiveVersion(ws, state.viewVersion) : 0;
  const { selection, editor } = state;
  return {
    session,
    screen: state.screen,
    workspace: ws?.name ?? null,
    role: state.role,
    version,
    latest: ws?.steps.length ?? 0,
    identity: dataIdentity(ws, state.role, version).key,
    selection: {
      columns: selection.columns,
      row: selection.row,
      cell: selection.cell ? { rid: selection.cell.rid, col: selection.cell.col } : null,
    },
    windows: windowsOf(state),
    editor: editor
      ? { op: editor.op, index: editor.editIndex ?? null, params: editor.params }
      : null,
    grid: { filter: state.gridView.filter, sort: state.gridView.sort, total: state.gridTotal },
  };
}
