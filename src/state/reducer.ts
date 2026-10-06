import type {
  ChartSpec,
  CsvSource,
  Step,
  VariableSpec,
  Workspace,
  WorkspaceDocument,
} from "../api/types";
import { DEFAULT_CHART_DRAFT, type ChartDraft } from "./chartDraft";
import { hydrateWorkspaceCharts } from "./chartStorage";
import {
  loadPanels,
  type PanelSide,
  type PanelsState,
} from "./panelStorage";
import { applyGridLayout, emptyDockLayouts, syncDockLayouts } from "./dockLayout";
import type { DockPos, DockRect, DockSize, DockState, ToolId } from "./dockTypes";
import { loadStoredDock } from "./dockStorage";
import {
  EMPTY_STEP_HISTORY,
  recordSteps,
  redoSteps,
  sameSteps,
  undoSteps,
  type PipelineSnapshot,
  type StepHistory,
} from "./stepHistory";
import { withColumnNote, withNote, withWorkspaceNote } from "./notes";
import { withDocumentNote } from "./documents";
import { applyStepOps, orderSteps, type StepOp } from "./stepOps";
import { fillStepIds, withNewId } from "./stepIds";
import { EMPTY_GRID_VIEW, gridViewKey, type GridView } from "./gridView";
import type { ToolViewState } from "./toolViews";
import type { WorkspaceSourcesState } from "./sourcesState";

export type { DockPos, DockSize, DockState, ToolId };

export type ScreenId = "sources" | "align" | "bench";
export type Role = "train" | "test";

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
  /**
   * Index of the applied step being edited (datatoolkit-issues#10); absent
   * for a new step. While set, the view is pinned to the step's input
   * version (`editIndex`) and Apply replaces the step at that index.
   */
  editIndex?: number;
}

export interface CtxMenuState {
  col: string;
  x: number;
  y: number;
}

export interface AppState {
  workspace: Workspace | null;
  /**
   * View-only grid filter / sort (datatoolkit-issues#81): sent to
   * `/workspace/rows`, never part of the workspace, the pipeline or the data
   * identity. Reset when another workspace is opened.
   */
  gridView: GridView;
  /** Column whose "Filter…" dialog is open above the grid (null = closed). */
  gridFilterColumn: string | null;
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
  /**
   * Per-window view choices (MAT-235): selected figure / Table view, display
   * controls, Details drawer. Keyed by tool id, stored like `toolParams`.
   */
  toolViews: Record<string, ToolViewState>;
  /** Current Chart tool draft (MAT-172); null until first open / prefill. */
  chartDraft: ChartDraft | null;
  /** Last engine error message while replaying / previewing (verbatim). */
  benchError: string | null;
  /**
   * Rows of the grid shown (after the view filter); published in the UI
   * context. null while the frame or the view's rows load.
   */
  gridTotal: number | null;
  /**
   * Sources screen file lists keyed by workspace name (FX-A / MAT-139).
   * Switching workspaces must not leak another workspace's files.
   */
  filesByWorkspace: Record<string, WorkspaceSourcesState>;
  /**
   * Undo / redo snapshots of the open workspace's steps (datatoolkit-issues#16),
   * in memory; reset when another workspace (or other steps) is loaded.
   */
  stepHistory: StepHistory;
  /** What the agent last touched, shown as a transient highlight (#88). */
  agentTouch: AgentTouch | null;
}

/** Columns / dock windows / step cards / rows / cells an agent command touched (#88). */
export interface AgentTouch {
  columns: string[];
  tools: ToolId[];
  /** Indices in the step list after the command. */
  steps: number[];
  /** Row ids (`rid`) a pick_row highlighted. */
  rows: number[];
  /** Cells a pick_cell highlighted. */
  cells: { rid: number; column: string }[];
  /** Identifies this touch; `AGENT_TOUCH_CLEAR` only clears the same one. */
  at: number;
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
  gridView: EMPTY_GRID_VIEW,
  gridFilterColumn: null,
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
  toolViews: {},
  chartDraft: null,
  benchError: null,
  gridTotal: null,
  filesByWorkspace: {},
  stepHistory: EMPTY_STEP_HISTORY,
  agentTouch: null,
};

export { orderSteps };

export type AppAction =
  | { type: "SET_WORKSPACE"; workspace: Workspace | null }
  | { type: "SET_SCREEN"; screen: ScreenId }
  | { type: "SET_ROLE"; role: Role }
  | { type: "SET_VIEW_VERSION"; version: number | null }
  /** Replace the view-only grid filter / sort (also the agent's `set_grid_view`). */
  | { type: "SET_GRID_VIEW"; view: GridView }
  | { type: "OPEN_GRID_FILTER"; column: string }
  | { type: "CLOSE_GRID_FILTER" }
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
  /** Open the editor on an applied step, pre-filled (datatoolkit-issues#10). */
  | { type: "EDIT_STEP"; index: number }
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
  | { type: "PATCH_TOOL_VIEW"; key: string; patch: ToolViewState }
  | { type: "SET_CHART_DRAFT"; draft: ChartDraft | null }
  | { type: "PATCH_CHART_DRAFT"; patch: Partial<ChartDraft> }
  | { type: "ADD_CHART"; chart: ChartSpec }
  | { type: "REMOVE_CHART"; name: string }
  | { type: "SET_CHARTS"; charts: ChartSpec[] }
  | { type: "SET_BENCH_ERROR"; message: string | null }
  | { type: "SET_GRID_TOTAL"; total: number | null }
  /** Agent-touch highlight (set / cleared by the agent bridge only, #88). */
  | { type: "AGENT_TOUCH"; touch: AgentTouch }
  | { type: "AGENT_TOUCH_CLEAR"; at: number }
  | { type: "ADD_STEP"; step: Step }
  /** Replace the step at `index` (keeps its `align` flag) and replay. */
  | { type: "REPLACE_STEP"; index: number; step: Step }
  | { type: "REMOVE_STEP"; index: number }
  /** Several step edits as ONE undo entry (agent bridge, #63); no-op if one op is invalid. */
  | { type: "APPLY_STEP_BATCH"; ops: StepOp[] }
  /** Pipeline history only (datatoolkit-issues#16); no-op while editing a step. */
  /** Notes (#152): one undoable change each; a blank text removes the note. */
  | { type: "SET_STEP_NOTE"; id: string; text: string }
  /** `key` = the column's origin name (`columnNoteKey`). */
  | { type: "SET_COLUMN_NOTE"; key: string; text: string }
  | { type: "SET_WORKSPACE_NOTE"; text: string }
  /** Documents (#178): add (with its id), remove, note; one undoable change each. */
  | { type: "ADD_DOCUMENT"; document: WorkspaceDocument }
  | { type: "REMOVE_DOCUMENT"; id: string }
  | { type: "SET_DOCUMENT_NOTE"; id: string; text: string }
  | { type: "UNDO_STEPS" }
  | { type: "REDO_STEPS" };

function openTool(tools: ToolId[], id: ToolId): ToolId[] {
  const next = [...tools];
  if (!next.includes(id)) {
    next.push(id);
    if (next.length > MAX_DOCK_TOOLS) next.shift();
  }
  return next;
}

/** Apply a dock change and keep layouts in step with open tools. */
function withDock(state: AppState, patch: Partial<DockState>): AppState {
  const merged = { ...state.dock, ...patch };
  const layouts = syncDockLayouts(merged.layouts, merged.tools);
  return { ...state, dock: { ...merged, layouts } };
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
  return stored ? { ...state.dock, ...stored, maximized: null } : state.dock;
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

/** Patch the open workspace (no-op without one); `extra` patches the state. */
/** True while the editor is open on an applied step (datatoolkit-issues#10). */
function isEditingStep(state: AppState): boolean {
  return state.editor?.editIndex !== undefined;
}

function withWorkspace(
  state: AppState,
  patch: Partial<Workspace>,
  extra: Partial<AppState> = {},
): AppState {
  if (!state.workspace) return state;
  return { ...state, ...extra, workspace: { ...state.workspace, ...patch } };
}

/** Target column mirrored for a newly set workspace (null when closed). */
function targetColumnFor(
  ws: Workspace | null,
  current: string | null,
): string | null {
  if (ws?.datasets.train.target_column) return ws.datasets.train.target_column;
  if (ws?.name === "churn") return "churn";
  // y-file join: prefer a conventional label name for the glyph / keys.
  if (ws?.datasets.train.y) return "target";
  return ws ? current : null;
}

/*
 * Sub-reducers, one per state domain. Each owns a disjoint set of action
 * types and returns undefined for the others, so `appReducer` tries them in
 * turn.
 */

/** Screen, panels, header badges and Sources file lists. */
function reduceShell(
  state: AppState,
  action: AppAction,
): AppState | undefined {
  switch (action.type) {
    case "SET_SCREEN":
      return { ...state, screen: action.screen, ctx: null };
    case "SET_ROLE":
      return { ...state, role: action.role };
    case "SET_GRID_VIEW":
      // A new filter / sort: the count is unknown until its rows load.
      return gridViewKey(action.view) === gridViewKey(state.gridView)
        ? { ...state, gridView: action.view }
        : { ...state, gridView: action.view, gridTotal: null };
    case "OPEN_GRID_FILTER":
      return { ...state, gridFilterColumn: action.column };
    case "CLOSE_GRID_FILTER":
      return { ...state, gridFilterColumn: null };
    case "SET_VIEW_VERSION":
      // Editing a step pins the view to that step's input version.
      if (state.editor?.editIndex !== undefined) return state;
      return { ...state, viewVersion: action.version };
    case "SET_PANEL_COLLAPSED": {
      // An unapplied step edit lives in the right slot: never collapse it.
      if (action.side === "right" && action.collapsed && state.editor) {
        return state;
      }
      if (state.panels[action.side] === action.collapsed) return state;
      return {
        ...state,
        panels: { ...state.panels, [action.side]: action.collapsed },
      };
    }
    case "SET_SHOW_EXPORT":
      return { ...state, showExport: action.show };
    case "SET_SUG_STAGE":
      return { ...state, sugStage: action.stage };
    case "SET_SUG_COUNT":
      return { ...state, sugCount: action.count };
    case "SET_ALIGN_TO_DECIDE_COUNT":
      return { ...state, alignToDecideCount: action.count };
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
    case "SET_TARGET_COLUMN":
      return { ...state, targetColumn: action.name };
    case "SET_DIST_BY":
      return { ...state, distBy: action.by };
    case "SET_BENCH_ERROR":
      return { ...state, benchError: action.message };
    case "SET_GRID_TOTAL":
      return state.gridTotal === action.total ? state : { ...state, gridTotal: action.total };
    case "AGENT_TOUCH":
      return { ...state, agentTouch: action.touch };
    case "AGENT_TOUCH_CLEAR":
      return state.agentTouch?.at === action.at
        ? { ...state, agentTouch: null }
        : state;
    default:
      return undefined;
  }
}

/** Grid selection and the column context menu. */
function reduceSelection(
  state: AppState,
  action: AppAction,
): AppState | undefined {
  switch (action.type) {
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
    default:
      return undefined;
  }
}

/** Step editor (right slot), including formula token insertion. */
function reduceEditor(
  state: AppState,
  action: AppAction,
): AppState | undefined {
  switch (action.type) {
    case "OPEN_EDITOR":
      return {
        ...state,
        editor: {
          op: action.op,
          params: action.params ?? {},
          target: action.target ?? "both",
        },
        ctx: null,
        // A new step goes after the latest version, not at an edited step.
        viewVersion: isEditingStep(state) ? null : state.viewVersion,
      };
    case "EDIT_STEP": {
      const step = state.workspace?.steps[action.index];
      if (!step) return state;
      return {
        ...state,
        editor: {
          op: step.op,
          params: { ...step.params },
          target: step.target,
          editIndex: action.index,
        },
        ctx: null,
        viewVersion: action.index,
        selection: { ...state.selection, row: null, cell: null },
      };
    }
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
      return {
        ...state,
        editor: null,
        viewVersion: isEditingStep(state) ? null : state.viewVersion,
      };
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
        viewVersion: isEditingStep(state) ? null : state.viewVersion,
      };
    }
    default:
      return undefined;
  }
}

/** Dock windows: open / close, position, size, grid layout. */
function reduceDock(
  state: AppState,
  action: AppAction,
): AppState | undefined {
  switch (action.type) {
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
    default:
      return undefined;
  }
}

/** Per-window analysis params and views, and the Chart tool draft. */
function reduceToolState(
  state: AppState,
  action: AppAction,
): AppState | undefined {
  switch (action.type) {
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
    case "PATCH_TOOL_VIEW": {
      const prev = state.toolViews[action.key] ?? {};
      return {
        ...state,
        toolViews: {
          ...state.toolViews,
          [action.key]: {
            ...prev,
            ...action.patch,
            display: action.patch.display
              ? { ...prev.display, ...action.patch.display }
              : prev.display,
          },
        },
      };
    }
    case "SET_CHART_DRAFT":
      return { ...state, chartDraft: action.draft };
    case "PATCH_CHART_DRAFT":
      return {
        ...state,
        chartDraft: {
          ...(state.chartDraft ?? DEFAULT_CHART_DRAFT),
          ...action.patch,
        },
      };
    default:
      return undefined;
  }
}

/** A workspace as Studio holds it: charts hydrated, every step with an id (#153). */
function loadedWorkspace(raw: Workspace): Workspace {
  const ws = hydrateWorkspaceCharts(raw);
  const steps = fillStepIds(ws.steps);
  return steps === ws.steps ? ws : { ...ws, steps };
}

/** Workspace documents (#178); recorded in the pipeline history. */
function reduceDocuments(state: AppState, action: AppAction): AppState | undefined {
  if (!state.workspace) return undefined;
  const documents = state.workspace.documents ?? [];
  switch (action.type) {
    case "ADD_DOCUMENT":
      if (documents.some((d) => d.id === action.document.id)) return state;
      return withWorkspace(state, { documents: [...documents, action.document] });
    case "REMOVE_DOCUMENT":
      if (!documents.some((d) => d.id === action.id)) return state;
      return withWorkspace(state, { documents: documents.filter((d) => d.id !== action.id) });
    case "SET_DOCUMENT_NOTE":
      if (!documents.some((d) => d.id === action.id)) return state;
      return withWorkspace(state, {
        documents: documents.map((d) => (d.id === action.id ? withDocumentNote(d, action.text) : d)),
      });
    default:
      return undefined;
  }
}

/** Step / column / workspace notes (#152); recorded in the pipeline history. */
function reduceNotes(state: AppState, action: AppAction): AppState | undefined {
  if (!state.workspace) return undefined;
  switch (action.type) {
    case "SET_STEP_NOTE": {
      const steps = state.workspace.steps;
      const at = steps.findIndex((s) => s.id === action.id);
      if (at < 0) return state;
      const next = steps.slice();
      next[at] = withNote(steps[at]!, action.text);
      return withWorkspace(state, { steps: next });
    }
    case "SET_COLUMN_NOTE":
      return withWorkspace(state, {
        notes: withColumnNote(state.workspace.notes, action.key, action.text),
      });
    case "SET_WORKSPACE_NOTE":
      return withWorkspace(state, {
        notes: withWorkspaceNote(state.workspace.notes, action.text),
      });
    default:
      return reduceDocuments(state, action);
  }
}

/** The open workspace: steps, variables, charts, test options. */
function reduceWorkspace(
  state: AppState,
  action: AppAction,
): AppState | undefined {
  switch (action.type) {
    case "SET_WORKSPACE": {
      const ws = action.workspace ? loadedWorkspace(action.workspace) : null;
      return {
        ...state,
        workspace: ws,
        // Columns differ per workspace: a view never follows to another one.
        ...(ws?.name === state.workspace?.name
          ? {}
          : { gridView: EMPTY_GRID_VIEW, gridFilterColumn: null }),
        sugCount: 0,
        targetColumn: targetColumnFor(ws, state.targetColumn),
        dock: dockForWorkspace(state, ws),
      };
    }
    case "SET_STEPS":
      return withWorkspace(state, { steps: orderSteps(fillStepIds(action.steps)) });
    case "ADD_STEP": {
      const current = state.workspace?.steps ?? [];
      return withWorkspace(
        state,
        { steps: orderSteps([...current, withNewId(action.step, current)]) },
        {
          editor: null,
          viewVersion: null,
          selection: { ...state.selection, row: null, cell: null },
          benchError: null,
        },
      );
    }
    case "REPLACE_STEP": {
      const old = state.workspace?.steps[action.index];
      if (!old) return state;
      // Same rule as a `replace` op: the slot keeps its id and `align` flag.
      const out = applyStepOps(state.workspace?.steps ?? [], [
        { replace: { index: action.index, step: action.step } },
      ]);
      if ("error" in out) return state;
      const steps = out.steps;
      return withWorkspace(
        state,
        { steps },
        {
          editor: null,
          viewVersion: null,
          selection: { ...state.selection, row: null, cell: null },
          benchError: null,
        },
      );
    }
    case "REMOVE_STEP": {
      const steps = (state.workspace?.steps ?? []).slice();
      if (action.index < 0 || action.index >= steps.length) return state;
      steps.splice(action.index, 1);
      return withWorkspace(
        state,
        { steps: orderSteps(steps) },
        {
          editor: null,
          viewVersion: null,
          selection: { ...state.selection, cell: null },
          benchError: null,
        },
      );
    }
    case "APPLY_STEP_BATCH": {
      const out = applyStepOps(state.workspace?.steps ?? [], action.ops);
      if ("error" in out) return state;
      return withWorkspace(
        state,
        { steps: out.steps },
        {
          editor: null,
          viewVersion: null,
          selection: { ...state.selection, row: null, cell: null },
          benchError: null,
        },
      );
    }
    case "ADD_ALIGN_STEP": {
      if (!state.workspace) return state;
      const current = state.workspace.steps;
      const s = { ...withNewId(action.step, current), align: true };
      const alignCount = current.filter((x) => x.align).length;
      const steps = [...current];
      steps.splice(alignCount, 0, s);
      return withWorkspace(state, { steps });
    }
    case "REMOVE_STEP_BY_INDEX":
      return withWorkspace(state, {
        steps: (state.workspace?.steps ?? []).filter(
          (_, i) => i !== action.index,
        ),
      });
    case "SET_TEST_DECIMAL": {
      if (!state.workspace || !state.workspace.datasets.test) return state;
      const testX = state.workspace.datasets.test.x;
      if (testX.kind !== "csv") return state;
      const updatedX: CsvSource = {
        ...testX,
        decimal: action.decimal ?? undefined,
      };
      return withWorkspace(state, {
        datasets: {
          ...state.workspace.datasets,
          test: { ...state.workspace.datasets.test, x: updatedX },
        },
      });
    }
    case "ADD_VARIABLE": {
      const vars = state.workspace?.variables ?? [];
      if (vars.some((v) => v.name === action.variable.name)) return state;
      return withWorkspace(state, { variables: [...vars, action.variable] });
    }
    case "REMOVE_VARIABLE":
      return withWorkspace(state, {
        variables: (state.workspace?.variables ?? []).filter(
          (v) => v.name !== action.name,
        ),
      });
    case "SET_VARIABLES":
      return withWorkspace(state, { variables: action.variables });
    case "ADD_CHART":
      return withWorkspace(state, {
        charts: [
          ...(state.workspace?.charts ?? []).filter(
            (c) => c.name !== action.chart.name,
          ),
          action.chart,
        ],
      });
    case "REMOVE_CHART":
      return withWorkspace(state, {
        charts: (state.workspace?.charts ?? []).filter(
          (c) => c.name !== action.name,
        ),
      });
    case "SET_CHARTS":
      return withWorkspace(state, { charts: action.charts });
    default:
      return undefined;
  }
}

/** Undo / redo: restore a steps snapshot and replay at the latest version. */
function reduceStepHistory(
  state: AppState,
  action: AppAction,
): AppState | undefined {
  if (action.type !== "UNDO_STEPS" && action.type !== "REDO_STEPS") {
    return undefined;
  }
  if (!state.workspace || state.editor) return state;
  const move = action.type === "UNDO_STEPS" ? undoSteps : redoSteps;
  const moved = move(state.stepHistory, snapshot(state.workspace));
  if (!moved) return state;
  return withWorkspace(
    state,
    {
      steps: moved.steps.steps,
      notes: moved.steps.notes,
      documents: moved.steps.documents,
    },
    {
      stepHistory: moved.history,
      viewVersion: null,
      selection: { ...state.selection, cell: null },
      benchError: null,
    },
  );
}

/**
 * Record a steps change as undoable. Loading a workspace keeps the history
 * only when it is the same workspace with the same steps (e.g. a Sources
 * edit); otherwise it starts empty.
 */
const snapshot = (ws: Workspace): PipelineSnapshot => ({
  steps: ws.steps,
  notes: ws.notes,
  documents: ws.documents,
});

function trackStepHistory(
  prev: AppState,
  next: AppState,
  action: AppAction,
): AppState {
  if (action.type === "UNDO_STEPS" || action.type === "REDO_STEPS") return next;
  const before = prev.workspace;
  const after = next.workspace;
  if (action.type === "SET_WORKSPACE") {
    const kept =
      before !== null &&
      after !== null &&
      before.name === after.name &&
      JSON.stringify(snapshot(before)) === JSON.stringify(snapshot(after));
    return kept || next.stepHistory === EMPTY_STEP_HISTORY
      ? next
      : { ...next, stepHistory: EMPTY_STEP_HISTORY };
  }
  if (!before || !after) return next;
  if (
    sameSteps(before.steps, after.steps) &&
    before.notes === after.notes &&
    before.documents === after.documents
  ) {
    return next;
  }
  return { ...next, stepHistory: recordSteps(next.stepHistory, snapshot(before)) };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  const next =
    reduceStepHistory(state, action) ??
    reduceShell(state, action) ??
    reduceSelection(state, action) ??
    reduceEditor(state, action) ??
    reduceDock(state, action) ??
    reduceToolState(state, action) ??
    reduceWorkspace(state, action) ??
    reduceNotes(state, action) ??
    state;
  return trackStepHistory(state, next, action);
}
