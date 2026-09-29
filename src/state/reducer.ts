import type {
  ChartSpec,
  CsvSource,
  Step,
  VariableSpec,
  Workspace,
} from "../api/types";
import type { ChartDraft } from "../bench/dock/chartPrefill";
import {
  hydrateWorkspaceCharts,
  saveStoredCharts,
} from "../bench/dock/chartStorage";
import {
  loadPanels,
  savePanels,
  type PanelSide,
  type PanelsState,
} from "./panelStorage";
import {
  applyGridLayout,
  emptyDockLayouts,
  syncDockLayouts,
  type DockLayouts,
  type DockRect,
} from "../bench/dock/dockLayout";
import { loadStoredDock, saveStoredDock } from "../bench/dock/dockStorage";
import type { WorkspaceSourcesState } from "../screens/sources/sourcesLogic";

export type ScreenId = "sources" | "align" | "bench";
export type Role = "train" | "test";
export type DockPos = "bottom" | "right";
export type DockSize = "S" | "M" | "L";
export type ToolId =
  | "compare"
  | "corr"
  | "dist"
  | "missing"
  | "outliers"
  | "target"
  | "drift"
  | "feature_selection"
  | "chart";

/** Course stage ids used by the Suggestions filter (prototype STAGES). */
export type CourseStage =
  | "all"
  | "import"
  | "clean"
  | "transform"
  | "select"
  | "custom";

export interface CellRef {
  rid: number;
  col: string;
}

export interface SelectionState {
  columns: string[];
  row: number | null;
  cell: CellRef | null;
  multi: boolean;
}

export interface EditorState {
  op: string | null;
  params: Record<string, unknown>;
  target: "train" | "test" | "both";
}

export interface DockState {
  tools: ToolId[];
  pos: DockPos;
  size: DockSize;
  maximized: ToolId | null;
  /** Grid rect per open window and dock position (MAT-234). */
  layouts: DockLayouts;
}

export interface CtxMenuState {
  col: string;
  x: number;
  y: number;
}

export interface AppState {
  workspace: Workspace | null;
  screen: ScreenId;
  role: Role;
  /** null = latest version */
  viewVersion: number | null;
  selection: SelectionState;
  editor: EditorState | null;
  dock: DockState;
  /** Collapsed side panels (MAT-232), persisted in localStorage. */
  panels: PanelsState;
  ctx: CtxMenuState | null;
  /* ---- W3: side panels / export (MAT-135) ---- */
  showExport: boolean;
  sugStage: CourseStage;
  /** Badge count for the Suggestions tab (updated by SuggestionsTab). */
  sugCount: number;
  /** Number of alignment items to decide (shown in header tab badge). */
  alignToDecideCount?: number | null;
  /* ---------- W2 workbench-core (MAT-134) ---------- */
  /** Target column name (y), mirrored for inspector / grid target glyph. */
  targetColumn: string | null;
  /**
   * Optional split column for the Distribution dock (`column_distribution.by`).
   * Null = no split. Set by "Distribution by…" or the window's split-by control.
   * The workspace target (incl. y-file join name) is the usual default when
   * opening Distribution by….
   */
  distBy: string | null;
  /**
   * Persisted analysis-key params for dock windows (MAT-174).
   * Keys are `toolId` or `toolId::column` (see `toolParamsKey`).
   */
  toolParams: Record<string, Record<string, unknown>>;
  /** Current Chart tool draft (MAT-172); null until first open / prefill. */
  chartDraft: ChartDraft | null;
  /** Last engine error message while replaying / previewing (verbatim). */
  benchError: string | null;
  /**
   * Sources screen file lists keyed by workspace name (FX-A / MAT-139).
   * Switching workspaces must not leak another workspace's files.
   */
  filesByWorkspace: Record<string, WorkspaceSourcesState>;
}

export const MAX_DOCK_TOOLS = 4;

export function emptyWorkspace(name = "untitled"): Workspace {
  return {
    name,
    datasets: {
      train: { x: { kind: "csv", path: "" } },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
    charts: [],
  };
}

export const initialState: AppState = {
  workspace: null,
  screen: "sources",
  role: "train",
  viewVersion: null,
  selection: { columns: [], row: null, cell: null, multi: false },
  editor: null,
  dock: {
    tools: [],
    pos: "bottom",
    size: "M",
    maximized: null,
    layouts: emptyDockLayouts(),
  },
  panels: loadPanels(),
  ctx: null,
  showExport: false,
  sugStage: "all",
  sugCount: 0,
  alignToDecideCount: null,
  /* W2 */
  targetColumn: "churn",
  distBy: null,
  toolParams: {},
  chartDraft: null,
  benchError: null,
  filesByWorkspace: {},
};

/** Keep `align: true` steps first (prototype / FRONT-WEB alignment rule). */
export function orderSteps(steps: Step[]): Step[] {
  const align = steps.filter((s) => s.align);
  const rest = steps.filter((s) => !s.align);
  return [...align, ...rest];
}

export type AppAction =
  | { type: "SET_WORKSPACE"; workspace: Workspace | null }
  | { type: "SET_SCREEN"; screen: ScreenId }
  | { type: "SET_ROLE"; role: Role }
  | { type: "SET_VIEW_VERSION"; version: number | null }
  | { type: "SET_PANEL_COLLAPSED"; side: PanelSide; collapsed: boolean }
  | { type: "SET_STEPS"; steps: Step[] }
  | { type: "TOGGLE_MULTI" }
  | {
      type: "PICK_COL";
      name: string;
      /** shift / meta / ctrl → add mode (also when multi is on) */
      add?: boolean;
    }
  | { type: "PICK_ROW"; rid: number }
  | { type: "PICK_CELL"; rid: number; col: string }
  | { type: "CLEAR_SELECTION" }
  | { type: "OPEN_CTX"; col: string; x: number; y: number }
  | { type: "CLOSE_CTX" }
  | {
      type: "OPEN_EDITOR";
      op: string | null;
      params?: Record<string, unknown>;
      target?: "train" | "test" | "both";
    }
  | { type: "SET_EDITOR_PARAMS"; params: Record<string, unknown> }
  | { type: "SET_EDITOR_TARGET"; target: "train" | "test" | "both" }
  | { type: "CLOSE_EDITOR" }
  | { type: "OPEN_TOOL"; id: ToolId }
  | { type: "TOGGLE_TOOL"; id: ToolId }
  | { type: "SET_DOCK_POS"; pos: DockPos }
  | { type: "SET_DOCK_SIZE"; size: DockSize }
  | {
      type: "SET_DOCK_LAYOUT";
      pos: DockPos;
      /** react-grid-layout items after a drag / resize (`i` = tool id). */
      items: ({ i: string } & DockRect)[];
    }
  | { type: "SET_MAXIMIZED"; id: ToolId | null }
  /* ---- W3 actions (MAT-135) ---- */
  | { type: "SET_SHOW_EXPORT"; show: boolean }
  | { type: "SET_SUG_STAGE"; stage: CourseStage }
  | { type: "SET_SUG_COUNT"; count: number }
  | { type: "ADD_VARIABLE"; variable: VariableSpec }
  | { type: "REMOVE_VARIABLE"; name: string }
  | { type: "SET_VARIABLES"; variables: VariableSpec[] }
  /** Insert `@name` into the formula editor (opens it if needed). W2 consumes. */
  | { type: "INSERT_FORMULA_TOKEN"; token: string }
  /* ---------- Stream W1 actions (Sources & Alignment) ---------- */
  | { type: "SET_ALIGN_TO_DECIDE_COUNT"; count: number | null }
  | { type: "ADD_ALIGN_STEP"; step: Step }
  | { type: "REMOVE_STEP_BY_INDEX"; index: number }
  | { type: "SET_TEST_DECIMAL"; decimal: string | null }
  | {
      type: "SET_WORKSPACE_FILES";
      name: string;
      sources: WorkspaceSourcesState;
    }
  | { type: "CLEAR_WORKSPACE_FILES"; name: string }
  /* W2 workbench-core */
  | { type: "SET_TARGET_COLUMN"; name: string | null }
  | { type: "SET_DIST_BY"; by: string | null }
  | {
      type: "SET_TOOL_PARAMS";
      /** Storage key from `toolParamsKey` (`toolId` or `toolId::column`). */
      key: string;
      params: Record<string, unknown>;
    }
  | { type: "CLEAR_TOOL_PARAMS"; key: string }
  | { type: "SET_CHART_DRAFT"; draft: ChartDraft | null }
  | { type: "PATCH_CHART_DRAFT"; patch: Partial<ChartDraft> }
  | { type: "ADD_CHART"; chart: ChartSpec }
  | { type: "REMOVE_CHART"; name: string }
  | { type: "SET_CHARTS"; charts: ChartSpec[] }
  | { type: "SET_BENCH_ERROR"; message: string | null }
  | { type: "ADD_STEP"; step: Step }
  | { type: "REMOVE_STEP"; index: number };

function openTool(tools: ToolId[], id: ToolId): ToolId[] {
  const next = [...tools];
  if (!next.includes(id)) {
    next.push(id);
    if (next.length > MAX_DOCK_TOOLS) next.shift();
  }
  return next;
}

/** Apply a dock change, keep layouts in step with open tools, persist. */
function withDock(state: AppState, patch: Partial<DockState>): AppState {
  const merged = { ...state.dock, ...patch };
  const dock = {
    ...merged,
    layouts: syncDockLayouts(merged.layouts, merged.tools),
  };
  if (state.workspace) saveStoredDock(state.workspace.name, dock);
  return { ...state, dock };
}

/**
 * Dock for a newly opened workspace: its stored layout when there is one
 * (MAT-234), otherwise the current dock (also covers renames).
 */
function dockForWorkspace(
  state: AppState,
  ws: Workspace | null,
): DockState {
  if (!ws || ws.name === state.workspace?.name) return state.dock;
  const stored = loadStoredDock(ws.name, MAX_DOCK_TOOLS);
  const dock = stored
    ? { ...state.dock, ...stored, maximized: null }
    : state.dock;
  saveStoredDock(ws.name, dock);
  return dock;
}

/**
 * Column pick rules from the prototype `pickCol`:
 * - add mode (multi or modifier): toggle name in the list
 * - otherwise: click same sole column → clear; else select only that column
 * Always clears row / cell / ctx.
 */
export function pickCol(
  selection: SelectionState,
  name: string,
  add = false,
): SelectionState {
  const useAdd = selection.multi || add;
  let columns: string[];
  if (useAdd) {
    columns = [...selection.columns];
    const i = columns.indexOf(name);
    if (i >= 0) columns.splice(i, 1);
    else columns.push(name);
  } else if (selection.columns.length === 1 && selection.columns[0] === name) {
    columns = [];
  } else {
    columns = [name];
  }
  return { ...selection, columns, row: null, cell: null };
}

function withVariables(
  state: AppState,
  variables: VariableSpec[],
): AppState {
  if (!state.workspace) return state;
  return {
    ...state,
    workspace: { ...state.workspace, variables },
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_WORKSPACE": {
      const raw = action.workspace;
      const ws = raw ? hydrateWorkspaceCharts(raw) : null;
      let targetColumn = state.targetColumn;
      if (ws?.datasets.train.target_column) {
        targetColumn = ws.datasets.train.target_column;
      } else if (ws?.name === "churn") {
        targetColumn = "churn";
      } else if (ws?.datasets.train.y) {
        // y-file join: prefer a conventional label name for the glyph / keys.
        targetColumn = "target";
      } else if (!ws) {
        targetColumn = null;
      }
      return {
        ...state,
        workspace: ws,
        sugCount: 0,
        targetColumn,
        dock: dockForWorkspace(state, ws),
      };
    }
    case "SET_SCREEN":
      return { ...state, screen: action.screen, ctx: null };
    case "SET_ROLE":
      return { ...state, role: action.role };
    case "SET_VIEW_VERSION":
      return { ...state, viewVersion: action.version };
    case "SET_PANEL_COLLAPSED": {
      // An unapplied step edit lives in the right slot: never collapse it.
      if (action.side === "right" && action.collapsed && state.editor) {
        return state;
      }
      if (state.panels[action.side] === action.collapsed) return state;
      const panels = { ...state.panels, [action.side]: action.collapsed };
      savePanels(panels);
      return { ...state, panels };
    }
    case "SET_STEPS": {
      if (!state.workspace) return state;
      return {
        ...state,
        workspace: {
          ...state.workspace,
          steps: orderSteps(action.steps),
        },
      };
    }
    case "TOGGLE_MULTI":
      return {
        ...state,
        selection: { ...state.selection, multi: !state.selection.multi },
      };
    case "PICK_COL":
      return {
        ...state,
        selection: pickCol(state.selection, action.name, action.add),
        ctx: null,
      };
    case "PICK_ROW": {
      const same = state.selection.row === action.rid;
      return {
        ...state,
        selection: {
          ...state.selection,
          row: same ? null : action.rid,
          cell: null,
          columns: [],
        },
        ctx: null,
      };
    }
    case "PICK_CELL": {
      const cur = state.selection.cell;
      const same =
        cur !== null && cur.rid === action.rid && cur.col === action.col;
      return {
        ...state,
        selection: {
          ...state.selection,
          cell: same ? null : { rid: action.rid, col: action.col },
          row: null,
          columns: [action.col],
        },
        ctx: null,
        editor: null,
      };
    }
    case "CLEAR_SELECTION":
      return {
        ...state,
        selection: {
          ...state.selection,
          columns: [],
          row: null,
          cell: null,
        },
        ctx: null,
      };
    case "OPEN_CTX": {
      const already = state.selection.columns.includes(action.col);
      return {
        ...state,
        ctx: { col: action.col, x: action.x, y: action.y },
        selection: {
          ...state.selection,
          columns: already ? state.selection.columns : [action.col],
          row: null,
          cell: null,
        },
      };
    }
    case "CLOSE_CTX":
      return { ...state, ctx: null };
    case "OPEN_EDITOR":
      return {
        ...state,
        editor: {
          op: action.op,
          params: action.params ?? {},
          target: action.target ?? "both",
        },
        ctx: null,
      };
    case "SET_EDITOR_PARAMS":
      if (!state.editor) return state;
      return {
        ...state,
        editor: { ...state.editor, params: action.params },
      };
    case "SET_EDITOR_TARGET":
      if (!state.editor) return state;
      return {
        ...state,
        editor: { ...state.editor, target: action.target },
      };
    case "CLOSE_EDITOR":
      return { ...state, editor: null };
    case "OPEN_TOOL":
      return {
        ...withDock(state, { tools: openTool(state.dock.tools, action.id) }),
        ctx: null,
      };
    case "TOGGLE_TOOL": {
      if (state.dock.tools.includes(action.id)) {
        return withDock(state, {
          tools: state.dock.tools.filter((t) => t !== action.id),
          maximized:
            state.dock.maximized === action.id ? null : state.dock.maximized,
        });
      }
      return {
        ...withDock(state, { tools: openTool(state.dock.tools, action.id) }),
        ctx: null,
      };
    }
    case "SET_DOCK_POS":
      return withDock(state, { pos: action.pos });
    case "SET_DOCK_SIZE":
      return withDock(state, { size: action.size });
    case "SET_DOCK_LAYOUT":
      return withDock(state, {
        layouts: applyGridLayout(
          state.dock.layouts,
          action.pos,
          action.items,
          state.dock.tools,
        ),
      });
    case "SET_MAXIMIZED":
      return { ...state, dock: { ...state.dock, maximized: action.id } };

    /* ---- W3: variables / suggestions / export ---- */
    case "SET_SHOW_EXPORT":
      return { ...state, showExport: action.show };
    case "SET_SUG_STAGE":
      return { ...state, sugStage: action.stage };
    case "SET_SUG_COUNT":
      return { ...state, sugCount: action.count };
    case "ADD_VARIABLE": {
      if (!state.workspace) return state;
      if (
        state.workspace.variables.some((v) => v.name === action.variable.name)
      ) {
        return state;
      }
      return withVariables(state, [
        ...state.workspace.variables,
        action.variable,
      ]);
    }
    case "REMOVE_VARIABLE": {
      if (!state.workspace) return state;
      return withVariables(
        state,
        state.workspace.variables.filter((v) => v.name !== action.name),
      );
    }
    case "SET_VARIABLES":
      return withVariables(state, action.variables);
    case "INSERT_FORMULA_TOKEN": {
      const token = action.token;
      if (state.editor?.op === "formula") {
        const prev = String(state.editor.params.expr ?? "").replace(/\s+$/, "");
        const expr = prev ? `${prev} ${token}` : token;
        return {
          ...state,
          editor: {
            ...state.editor,
            params: { ...state.editor.params, expr },
          },
          ctx: null,
        };
      }
      return {
        ...state,
        editor: {
          op: "formula",
          params: { expr: token },
          target: "both",
        },
        ctx: null,
      };
    }

    /* ---------- Stream W1 actions (Sources & Alignment) ---------- */
    case "SET_ALIGN_TO_DECIDE_COUNT":
      return { ...state, alignToDecideCount: action.count };

    case "ADD_ALIGN_STEP": {
      if (!state.workspace) return state;
      const s = { ...action.step, align: true };
      const current = state.workspace.steps;
      const alignCount = current.filter((x) => x.align).length;
      const steps = [...current];
      steps.splice(alignCount, 0, s);
      return {
        ...state,
        workspace: {
          ...state.workspace,
          steps,
        },
      };
    }

    case "REMOVE_STEP_BY_INDEX": {
      if (!state.workspace) return state;
      const steps = state.workspace.steps.filter((_, i) => i !== action.index);
      return {
        ...state,
        workspace: {
          ...state.workspace,
          steps,
        },
      };
    }

    case "SET_TEST_DECIMAL": {
      if (!state.workspace || !state.workspace.datasets.test) return state;
      const testX = state.workspace.datasets.test.x;
      if (testX.kind !== "csv") return state;
      const updatedX: CsvSource = {
        ...testX,
        decimal: action.decimal ?? undefined,
      };
      return {
        ...state,
        workspace: {
          ...state.workspace,
          datasets: {
            ...state.workspace.datasets,
            test: {
              ...state.workspace.datasets.test,
              x: updatedX,
            },
          },
        },
      };
    }

    case "SET_WORKSPACE_FILES":
      return {
        ...state,
        filesByWorkspace: {
          ...state.filesByWorkspace,
          [action.name]: action.sources,
        },
      };

    case "CLEAR_WORKSPACE_FILES": {
      const next = { ...state.filesByWorkspace };
      delete next[action.name];
      return { ...state, filesByWorkspace: next };
    }

    /* ---------- W2 workbench-core ---------- */
    case "SET_TARGET_COLUMN":
      return { ...state, targetColumn: action.name };
    case "SET_DIST_BY":
      return { ...state, distBy: action.by };
    case "SET_TOOL_PARAMS":
      return {
        ...state,
        toolParams: {
          ...state.toolParams,
          [action.key]: action.params,
        },
      };
    case "CLEAR_TOOL_PARAMS": {
      if (!(action.key in state.toolParams)) return state;
      const next = { ...state.toolParams };
      delete next[action.key];
      return { ...state, toolParams: next };
    }
    case "SET_CHART_DRAFT":
      return { ...state, chartDraft: action.draft };
    case "PATCH_CHART_DRAFT": {
      if (!state.chartDraft) {
        return {
          ...state,
          chartDraft: {
            chart: "histogram",
            x: null,
            y: null,
            color: null,
            facet_row: null,
            facet_col: null,
            size: null,
            columns: [],
            agg: null,
            trendline: false,
            log_x: false,
            log_y: false,
            bins: 30,
            sample_size: 10_000,
            ...action.patch,
          },
        };
      }
      return {
        ...state,
        chartDraft: { ...state.chartDraft, ...action.patch },
      };
    }
    case "ADD_CHART": {
      if (!state.workspace) return state;
      const charts = [
        ...(state.workspace.charts ?? []).filter(
          (c) => c.name !== action.chart.name,
        ),
        action.chart,
      ];
      saveStoredCharts(state.workspace.name, charts);
      return {
        ...state,
        workspace: { ...state.workspace, charts },
      };
    }
    case "REMOVE_CHART": {
      if (!state.workspace) return state;
      const charts = (state.workspace.charts ?? []).filter(
        (c) => c.name !== action.name,
      );
      saveStoredCharts(state.workspace.name, charts);
      return {
        ...state,
        workspace: { ...state.workspace, charts },
      };
    }
    case "SET_CHARTS": {
      if (!state.workspace) return state;
      saveStoredCharts(state.workspace.name, action.charts);
      return {
        ...state,
        workspace: { ...state.workspace, charts: action.charts },
      };
    }
    case "SET_BENCH_ERROR":
      return { ...state, benchError: action.message };
    case "ADD_STEP": {
      if (!state.workspace) return state;
      return {
        ...state,
        workspace: {
          ...state.workspace,
          steps: orderSteps([...state.workspace.steps, action.step]),
        },
        editor: null,
        viewVersion: null,
        selection: {
          ...state.selection,
          row: null,
          cell: null,
        },
        benchError: null,
      };
    }
    case "REMOVE_STEP": {
      if (!state.workspace) return state;
      const steps = state.workspace.steps.slice();
      if (action.index < 0 || action.index >= steps.length) return state;
      steps.splice(action.index, 1);
      return {
        ...state,
        workspace: { ...state.workspace, steps: orderSteps(steps) },
        editor: null,
        viewVersion: null,
        selection: { ...state.selection, cell: null },
        benchError: null,
      };
    }
    default:
      return state;
  }
}
