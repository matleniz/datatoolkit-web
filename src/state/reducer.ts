import type { CsvSource, Step, VariableSpec, Workspace } from "../api/types";
import type { WorkspaceSourcesState } from "../screens/sources/sourcesLogic";

export type ScreenId = "sources" | "align" | "bench";
export type Role = "train" | "test";
export type LeftTab = "vars" | "suggestions" | "recipe";
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
  | "feature_selection";

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
  wide: Partial<Record<ToolId, boolean>>;
  pos: DockPos;
  size: DockSize;
  maximized: ToolId | null;
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
  leftTab: LeftTab;
  ctx: CtxMenuState | null;
  /** Source of a dock drag reorder (mirrors prototype `_drag`). */
  dockDragFrom: ToolId | null;
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
    wide: {},
    pos: "bottom",
    size: "M",
    maximized: null,
  },
  leftTab: "vars",
  ctx: null,
  dockDragFrom: null,
  showExport: false,
  sugStage: "all",
  sugCount: 0,
  alignToDecideCount: null,
  /* W2 */
  targetColumn: "churn",
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
  | { type: "SET_LEFT_TAB"; tab: LeftTab }
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
  | { type: "MOVE_TOOL"; id: ToolId; delta: number }
  | { type: "DRAG_TOOL"; id: ToolId }
  | { type: "DROP_TOOL"; id: ToolId }
  | { type: "SET_DOCK_POS"; pos: DockPos }
  | { type: "SET_DOCK_SIZE"; size: DockSize }
  | { type: "TOGGLE_WIDE"; id: ToolId }
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
      const ws = action.workspace;
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
      return { ...state, workspace: ws, sugCount: 0, targetColumn };
    }
    case "SET_SCREEN":
      return { ...state, screen: action.screen, ctx: null };
    case "SET_ROLE":
      return { ...state, role: action.role };
    case "SET_VIEW_VERSION":
      return { ...state, viewVersion: action.version };
    case "SET_LEFT_TAB":
      return { ...state, leftTab: action.tab };
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
        ...state,
        dock: { ...state.dock, tools: openTool(state.dock.tools, action.id) },
        ctx: null,
      };
    case "TOGGLE_TOOL": {
      const i = state.dock.tools.indexOf(action.id);
      if (i >= 0) {
        const tools = state.dock.tools.filter((t) => t !== action.id);
        return {
          ...state,
          dock: {
            ...state.dock,
            tools,
            maximized:
              state.dock.maximized === action.id ? null : state.dock.maximized,
          },
        };
      }
      return {
        ...state,
        dock: { ...state.dock, tools: openTool(state.dock.tools, action.id) },
        ctx: null,
      };
    }
    case "MOVE_TOOL": {
      const tools = [...state.dock.tools];
      const i = tools.indexOf(action.id);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= tools.length) return state;
      const [item] = tools.splice(i, 1);
      if (item === undefined) return state;
      tools.splice(j, 0, item);
      return { ...state, dock: { ...state.dock, tools } };
    }
    case "DRAG_TOOL":
      return { ...state, dockDragFrom: action.id };
    case "DROP_TOOL": {
      const from = state.dockDragFrom;
      if (!from || from === action.id) {
        return { ...state, dockDragFrom: null };
      }
      const tools = [...state.dock.tools];
      const fromIx = tools.indexOf(from);
      const toIx = tools.indexOf(action.id);
      if (fromIx < 0 || toIx < 0) {
        return { ...state, dockDragFrom: null };
      }
      tools.splice(fromIx, 1);
      const insertAt = tools.indexOf(action.id);
      tools.splice(insertAt, 0, from);
      return { ...state, dock: { ...state.dock, tools }, dockDragFrom: null };
    }
    case "SET_DOCK_POS":
      return { ...state, dock: { ...state.dock, pos: action.pos } };
    case "SET_DOCK_SIZE":
      return { ...state, dock: { ...state.dock, size: action.size } };
    case "TOGGLE_WIDE": {
      const wide = { ...state.dock.wide };
      wide[action.id] = !wide[action.id];
      return { ...state, dock: { ...state.dock, wide } };
    }
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
