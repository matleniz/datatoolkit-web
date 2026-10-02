import type { JsonSchema, Role, Step } from "../api/types";
import { toolDef } from "../bench/toolrail/tools";
import { TOOL_IDS, type ToolId } from "./dockTypes";
import { appReducer, type AppAction, type AppState } from "./reducer";
import { applyStepOps, type StepOp } from "./stepOps";
import { currentIdentityKey } from "./uiContext";
import { PER_COLUMN_PARAM_TOOLS, keyTunableFields, toolParamsKey } from "../bench/left/keyTunable";
import type { EditorField } from "../bench/schemaFields";

/**
 * Commands the engine's UI bridge relays to Studio (`GET /api/ui/events`) and
 * how Studio runs them (datatoolkit-issues#63). Studio stays the single
 * writer: a step edit goes through the reducer as ONE undoable action, is
 * persisted through the save gate, and only then acked with the new identity.
 */
export type AgentCommand =
  | {
      type: "propose_steps";
      workspace: string;
      base_identity: string;
      ops: StepOp[];
    }
  | { type: "open_window"; tool: ToolId; params: Record<string, unknown> }
  | { type: "select_columns"; columns: string[] }
  | { type: "set_view"; role?: Role; version?: number | null }
  | { type: "pick_row"; rid: number }
  | { type: "pick_cell"; rid: number; column: string }
  | { type: "clear_selection" }
  | { type: "set_target"; column: string | null }
  | { type: "set_dist_by"; by: string | null }
  | {
      type: "set_tool_params";
      tool: ToolId;
      params: Record<string, unknown>;
      column?: string;
    };

/** Body of `POST /api/ui/ack`. */
export interface Ack {
  id: string;
  ok: boolean;
  error?: string;
  identity?: string;
}

/** A destructive proposal waiting for the user's Apply / Dismiss. */
export interface Proposal {
  id: string;
  summary: string;
  lines: string[];
}

export interface BridgeDeps {
  getState(): AppState;
  dispatch(action: AppAction): void;
  /** Resolve once the dispatched change is rendered and stored in the engine. */
  settle(): Promise<void>;
  /** Show the proposal; resolve true on Apply, false on Dismiss. */
  review(proposal: Proposal): Promise<boolean>;
  /**
   * Applied-at-once notice. `undo` = the reducer actions that revert THIS
   * command (the Undo button dispatches them); omitted = a notice without Undo.
   */
  announce(summary: string, undo?: AppAction[]): void;
  /** Highlight what the command touched for a moment (`data-agent-touched`). */
  touch(touched: Touched): void;
  /** Column names of the frame shown now (validates `column` / `by`). */
  frameColumns(): Promise<string[]>;
  /** Engine schema of a key (validates `set_tool_params`); cached by the client. */
  keySchema(keyId: string): Promise<JsonSchema>;
}

/** What a command touched; every field optional, later commands declare only theirs. */
export interface Touched {
  columns?: string[];
  tools?: ToolId[];
  /** Indices in the step list after the command. */
  steps?: number[];
  /** Row ids (`rid`) of the grid. */
  rows?: number[];
  cells?: { rid: number; column: string }[];
}

/**
 * How a non-destructive command ended: the toast line, the actions that revert
 * it and what it touched. Shared by every command so a new one only builds this.
 */
export interface Outcome {
  summary: string;
  undo?: AppAction[];
  touched: Touched;
}

const DESTRUCTIVE_OPS = new Set([
  "drop_columns",
  "filter_rows",
  "drop_low_variance",
  "drop_correlated",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseStep(raw: unknown): Step | string {
  if (!isRecord(raw)) return "step must be an object";
  if (typeof raw.op !== "string" || !raw.op) return "step.op must be a string";
  const target = raw.target ?? "both";
  if (target !== "train" && target !== "test" && target !== "both") {
    return "step.target must be train, test or both";
  }
  const params = raw.params ?? {};
  if (!isRecord(params)) return "step.params must be an object";
  return { op: raw.op, target, params };
}

function parseOp(raw: unknown, n: number): StepOp | string {
  const bad = (why: string) => `ops[${n}]: ${why}`;
  if (!isRecord(raw)) return bad("must be an object");
  const kinds = ["add", "replace", "remove"].filter((k) => k in raw);
  if (kinds.length !== 1) return bad("expected exactly one of add / replace / remove");
  const body = raw[kinds[0]!];
  if (!isRecord(body)) return bad(`${kinds[0]} must be an object`);
  if (kinds[0] === "remove") {
    if (!Number.isInteger(body.index)) return bad("remove.index must be an integer");
    return { remove: { index: body.index as number } };
  }
  const step = parseStep(body.step);
  if (typeof step === "string") return bad(step);
  if (kinds[0] === "add") return { add: { step } };
  if (!Number.isInteger(body.index)) return bad("replace.index must be an integer");
  return { replace: { index: body.index as number, step } };
}

type Parsed<T> = T | { error: string };

function parseProposeSteps(raw: Record<string, unknown>): Parsed<AgentCommand> {
  if (typeof raw.workspace !== "string") return { error: "workspace must be a string" };
  if (typeof raw.base_identity !== "string") {
    return { error: "base_identity must be a string" };
  }
  if (!Array.isArray(raw.ops) || raw.ops.length === 0) {
    return { error: "ops must be a non-empty list" };
  }
  const ops: StepOp[] = [];
  for (const [n, o] of raw.ops.entries()) {
    const op = parseOp(o, n);
    if (typeof op === "string") return { error: op };
    ops.push(op);
  }
  return {
    type: "propose_steps",
    workspace: raw.workspace,
    base_identity: raw.base_identity,
    ops,
  };
}

function parseOpenWindow(raw: Record<string, unknown>): Parsed<AgentCommand> {
  if (!TOOL_IDS.includes(raw.tool as ToolId)) {
    return { error: `tool must be one of ${TOOL_IDS.join(", ")}` };
  }
  if (raw.params !== undefined && !isRecord(raw.params)) {
    return { error: "params must be an object" };
  }
  return {
    type: "open_window",
    tool: raw.tool as ToolId,
    params: (raw.params as Record<string, unknown> | undefined) ?? {},
  };
}

function parseSetView(raw: Record<string, unknown>): Parsed<AgentCommand> {
  const { role, version } = raw;
  if (role !== undefined && role !== "train" && role !== "test") {
    return { error: "role must be train or test" };
  }
  const versionOk =
    version === undefined ||
    version === null ||
    (Number.isInteger(version) && (version as number) >= 0);
  if (!versionOk) return { error: "version must be a non-negative integer or null" };
  if (role === undefined && version === undefined) {
    return { error: "set_view needs role and / or version" };
  }
  return {
    type: "set_view",
    ...(role !== undefined ? { role } : {}),
    ...(version !== undefined ? { version: version as number | null } : {}),
  };
}

const isRid = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function parsePickRow(raw: Record<string, unknown>): Parsed<AgentCommand> {
  if (!isRid(raw.rid)) return { error: "rid must be a non-negative integer" };
  return { type: "pick_row", rid: raw.rid };
}

function parsePickCell(raw: Record<string, unknown>): Parsed<AgentCommand> {
  if (!isRid(raw.rid)) return { error: "rid must be a non-negative integer" };
  if (!isColumnName(raw.column)) return { error: "column must be a non-empty string" };
  return { type: "pick_cell", rid: raw.rid, column: raw.column };
}

const isColumnName = (v: unknown): v is string => typeof v === "string" && v !== "";

function parseSetTarget(raw: Record<string, unknown>): Parsed<AgentCommand> {
  if (raw.column !== null && !isColumnName(raw.column)) {
    return { error: "column must be a non-empty string or null" };
  }
  return { type: "set_target", column: raw.column };
}

function parseSetDistBy(raw: Record<string, unknown>): Parsed<AgentCommand> {
  if (raw.by !== null && !isColumnName(raw.by)) {
    return { error: "by must be a non-empty string or null" };
  }
  return { type: "set_dist_by", by: raw.by };
}

function parseSetToolParams(raw: Record<string, unknown>): Parsed<AgentCommand> {
  if (!TOOL_IDS.includes(raw.tool as ToolId)) {
    return { error: `tool must be one of ${TOOL_IDS.join(", ")}` };
  }
  if (!isRecord(raw.params) || Object.keys(raw.params).length === 0) {
    return { error: "params must be a non-empty object" };
  }
  if (raw.column !== undefined && !isColumnName(raw.column)) {
    return { error: "column must be a non-empty string" };
  }
  return {
    type: "set_tool_params",
    tool: raw.tool as ToolId,
    params: raw.params,
    ...(raw.column !== undefined ? { column: raw.column } : {}),
  };
}

/** Validate a relayed command; the error text is the `bad_command: …` reason. */
export function parseCommand(raw: Record<string, unknown>): Parsed<AgentCommand> {
  switch (raw.type) {
    case "propose_steps":
      return parseProposeSteps(raw);
    case "open_window":
      return parseOpenWindow(raw);
    case "select_columns": {
      const cols = raw.columns;
      if (!Array.isArray(cols) || !cols.every((c) => typeof c === "string")) {
        return { error: "columns must be a list of strings" };
      }
      return { type: "select_columns", columns: [...new Set(cols as string[])] };
    }
    case "set_view":
      return parseSetView(raw);
    case "pick_row":
      return parsePickRow(raw);
    case "pick_cell":
      return parsePickCell(raw);
    case "clear_selection":
      return { type: "clear_selection" };
    case "set_target":
      return parseSetTarget(raw);
    case "set_dist_by":
      return parseSetDistBy(raw);
    case "set_tool_params":
      return parseSetToolParams(raw);
    default:
      return { error: `unknown type ${JSON.stringify(raw.type)}` };
  }
}

/** A remove, or an add / replace of an op that drops columns or rows. */
export function isDestructive(ops: StepOp[]): boolean {
  return ops.some(
    (op) =>
      "remove" in op ||
      DESTRUCTIVE_OPS.has(("add" in op ? op.add : op.replace).step.op),
  );
}

function stepLabel(step: Step): string {
  const cols = step.params.columns;
  const on = Array.isArray(cols) && cols.length > 0 ? ` (${cols.join(", ")})` : "";
  return `${step.op}${on}`;
}

/** One line per op, for the review banner. */
export function describeOps(ops: StepOp[], steps: Step[]): string[] {
  return ops.map((op) => {
    if ("add" in op) return `add ${stepLabel(op.add.step)}`;
    if ("replace" in op) {
      const old = steps[op.replace.index];
      return `replace step ${op.replace.index + 1}${old ? ` (${old.op})` : ""} with ${stepLabel(op.replace.step)}`;
    }
    const old = steps[op.remove.index];
    return `remove step ${op.remove.index + 1}${old ? ` (${old.op})` : ""}`;
  });
}

/** Short title: the single op's line, else the op count. */
function summarizeOps(ops: StepOp[], steps: Step[]): string {
  const lines = describeOps(ops, steps);
  return lines.length === 1 ? lines[0]! : `${lines.length} step changes`;
}

/** Actions that put the selection back as it is in `state`. */
function restoreSelection(state: AppState): AppAction[] {
  return [
    { type: "CLEAR_SELECTION" },
    ...state.selection.columns.map((name): AppAction => ({ type: "PICK_COL", name, add: true })),
  ];
}

/** Actions that put the row / cell / column selection back as it is in `state`. */
function restoreFullSelection(state: AppState): AppAction[] {
  const { row, cell } = state.selection;
  if (cell) return [{ type: "CLEAR_SELECTION" }, { type: "PICK_CELL", rid: cell.rid, col: cell.col }];
  if (row !== null) return [{ type: "CLEAR_SELECTION" }, { type: "PICK_ROW", rid: row }];
  return restoreSelection(state);
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

type ViewCommand = Extract<
  AgentCommand,
  { type: "open_window" | "select_columns" | "set_view" }
>;

/** Actions of a non-step command (open_window / select_columns / set_view). */
function viewActions(cmd: ViewCommand): AppAction[] {
  if (cmd.type === "select_columns") {
    return [
      { type: "CLEAR_SELECTION" },
      ...cmd.columns.map((name): AppAction => ({ type: "PICK_COL", name, add: true })),
    ];
  }
  if (cmd.type === "set_view") {
    return [
      ...(cmd.role ? [{ type: "SET_ROLE", role: cmd.role } as const] : []),
      ...(cmd.version !== undefined
        ? [{ type: "SET_VIEW_VERSION", version: cmd.version } as const]
        : []),
    ];
  }
  const { column, by, ...rest } = cmd.params;
  const actions: AppAction[] = [{ type: "OPEN_TOOL", id: cmd.tool }];
  const col = typeof column === "string" && column ? column : null;
  if (col) actions.push({ type: "CLEAR_SELECTION" }, { type: "PICK_COL", name: col, add: true });
  if (typeof by === "string") actions.push({ type: "SET_DIST_BY", by: by || null });
  if (Object.keys(rest).length > 0) {
    const perColumn = PER_COLUMN_PARAM_TOOLS.has(cmd.tool);
    actions.push({
      type: "SET_TOOL_PARAMS",
      key: toolParamsKey(cmd.tool, perColumn ? col : null),
      params: rest,
    });
  }
  return actions;
}

/** Toast line, undo actions and touched set of a view command, from the state before it. */
function viewOutcome(cmd: ViewCommand, before: AppState): Outcome {
  if (cmd.type === "select_columns") {
    const same = sameList(before.selection.columns, cmd.columns);
    return {
      summary: cmd.columns.length ? `selected ${cmd.columns.join(", ")}` : "cleared the selection",
      undo: same ? undefined : restoreSelection(before),
      touched: { columns: cmd.columns },
    };
  }
  if (cmd.type === "set_view") {
    const role = cmd.role ?? before.role;
    const version = cmd.version === undefined ? before.viewVersion : cmd.version;
    return {
      summary: `showing ${role} ${version === null ? "latest" : `v${version}`}`,
      undo: [
        { type: "SET_ROLE", role: before.role },
        { type: "SET_VIEW_VERSION", version: before.viewVersion },
      ],
      touched: {},
    };
  }
  const col = typeof cmd.params.column === "string" && cmd.params.column ? cmd.params.column : null;
  const wasOpen = before.dock.tools.includes(cmd.tool);
  const undo: AppAction[] = [];
  if (!wasOpen) undo.push({ type: "TOGGLE_TOOL", id: cmd.tool });
  if (col) undo.push(...restoreSelection(before));
  const label = toolDef(cmd.tool).label;
  return {
    summary: `opened ${label}${col ? ` (${col})` : ""}`,
    undo: undo.length ? undo : undefined,
    touched: { tools: [cmd.tool], ...(col ? { columns: [col] } : {}) },
  };
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isListOf = (v: unknown, ok: (x: unknown) => boolean) => Array.isArray(v) && v.every(ok);

/** What each widget accepts: a description for the error, and the check. */
const WIDGET_VALUES: Partial<
  Record<EditorField["widget"], [want: string, ok: (v: unknown, columns: string[]) => boolean]>
> = {
  number: ["a number", isFiniteNumber],
  auto_number: ['a number or "auto"', (v) => v === "auto" || isFiniteNumber(v)],
  bool: ["a boolean", (v) => typeof v === "boolean"],
  text: ["a string", (v) => typeof v === "string"],
  column: ["a column of the frame", (v, cols) => typeof v === "string" && cols.includes(v)],
  columns: [
    "a list of columns of the frame",
    (v, cols) => isListOf(v, (c) => typeof c === "string" && cols.includes(c)),
  ],
  number_list: ["a list of numbers", (v) => isListOf(v, isFiniteNumber)],
  string_list: ["a list of strings", (v) => isListOf(v, (x) => typeof x === "string")],
  enum_list: ["a list of strings", (v) => isListOf(v, (x) => typeof x === "string")],
};

/** Why `value` is not acceptable for `field` (null = it is). */
function badFieldValue(field: EditorField, value: unknown, columns: string[]): string | null {
  const bad = (want: string) => `params.${field.key} must be ${want}`;
  if (field.widget === "enum") {
    const allowed = (field.enumValues ?? []).filter((v) => v !== "__null__");
    const nullable = field.enumValues?.includes("__null__") ?? false;
    const ok = value === null ? nullable : allowed.includes(String(value));
    return ok ? null : bad(`one of ${allowed.join(", ")}`);
  }
  const rule = WIDGET_VALUES[field.widget];
  if (!rule) return isRecord(value) ? null : bad("an object");
  return rule[1](value, columns) ? null : bad(rule[0]);
}

/** Why `cmd` cannot run on a frame with `columns` / the key's `schema` (null = it can). */
function badToolParams(
  cmd: Extract<AgentCommand, { type: "set_tool_params" }>,
  schema: JsonSchema,
  columns: string[],
): string | null {
  const keyId = toolDef(cmd.tool).key;
  const fields = new Map(keyTunableFields(schema, keyId).map((f) => [f.key, f]));
  if (fields.size === 0) return `${cmd.tool} has no tunable params`;
  if (cmd.column !== undefined) {
    if (!PER_COLUMN_PARAM_TOOLS.has(cmd.tool)) return `${cmd.tool} has no per-column params`;
    if (!columns.includes(cmd.column)) return `unknown column ${JSON.stringify(cmd.column)}`;
  }
  for (const [key, value] of Object.entries(cmd.params)) {
    const field = fields.get(key);
    if (!field) {
      return `unknown param ${JSON.stringify(key)} for ${cmd.tool} (known: ${[...fields.keys()].join(", ")})`;
    }
    const why = badFieldValue(field, value, columns);
    if (why) return why;
  }
  return null;
}

/** Column whose params the window reads: the explicit one, else the focus (as the dock does). */
function paramColumn(
  cmd: Extract<AgentCommand, { type: "set_tool_params" }>,
  state: AppState,
): string | null {
  if (!PER_COLUMN_PARAM_TOOLS.has(cmd.tool)) return null;
  return cmd.column ?? state.selection.columns[0] ?? state.selection.cell?.col ?? null;
}

/** Actions + outcome of the three "set one thing" commands, from the state before them. */
function settingOutcome(
  cmd: Extract<AgentCommand, { type: "set_target" | "set_dist_by" | "set_tool_params" }>,
  before: AppState,
): { actions: AppAction[]; outcome: Outcome } {
  if (cmd.type === "set_target") {
    const same = before.targetColumn === cmd.column;
    return {
      actions: [{ type: "SET_TARGET_COLUMN", name: cmd.column }],
      outcome: {
        summary: cmd.column ? `target set to ${cmd.column}` : "target cleared",
        undo: same ? undefined : [{ type: "SET_TARGET_COLUMN", name: before.targetColumn }],
        touched: { columns: cmd.column ? [cmd.column] : [] },
      },
    };
  }
  if (cmd.type === "set_dist_by") {
    const same = before.distBy === cmd.by;
    return {
      actions: [{ type: "SET_DIST_BY", by: cmd.by }],
      outcome: {
        summary: cmd.by ? `Distribution split by ${cmd.by}` : "Distribution split cleared",
        undo: same ? undefined : [{ type: "SET_DIST_BY", by: before.distBy }],
        touched: { tools: ["dist"], columns: cmd.by ? [cmd.by] : [] },
      },
    };
  }
  const column = paramColumn(cmd, before);
  const key = toolParamsKey(cmd.tool, column);
  const previous = before.toolParams[key];
  const merged = { ...previous, ...cmd.params };
  const same = previous !== undefined && Object.entries(merged).every(([k, v]) => previous[k] === v);
  return {
    actions: [{ type: "SET_TOOL_PARAMS", key, params: merged }],
    outcome: {
      summary: `${toolDef(cmd.tool).label} params: ${Object.entries(cmd.params)
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`)
        .join(", ")}${column ? ` (${column})` : ""}`,
      undo: same
        ? undefined
        : [previous ? { type: "SET_TOOL_PARAMS", key, params: previous } : { type: "CLEAR_TOOL_PARAMS", key }],
      touched: { tools: [cmd.tool], ...(column ? { columns: [column] } : {}) },
    },
  };
}

/** Actions + outcome of pick_row / pick_cell / clear_selection, from the state before them. */
function pickOutcome(
  cmd: Extract<AgentCommand, { type: "pick_row" | "pick_cell" | "clear_selection" }>,
  before: AppState,
): { actions: AppAction[]; outcome: Outcome } {
  const { row, cell, columns } = before.selection;
  const undo = restoreFullSelection(before);
  if (cmd.type === "pick_row") {
    // PICK_ROW toggles: picking the row already picked must not clear it.
    const same = row === cmd.rid;
    return {
      actions: same ? [] : [{ type: "PICK_ROW", rid: cmd.rid }],
      outcome: { summary: `selected row ${cmd.rid}`, undo: same ? undefined : undo, touched: { rows: [cmd.rid] } },
    };
  }
  if (cmd.type === "pick_cell") {
    const same = cell?.rid === cmd.rid && cell.col === cmd.column;
    return {
      actions: same ? [] : [{ type: "PICK_CELL", rid: cmd.rid, col: cmd.column }],
      outcome: {
        summary: `selected cell ${cmd.column} of row ${cmd.rid}`,
        undo: same ? undefined : undo,
        touched: { cells: [{ rid: cmd.rid, column: cmd.column }], columns: [cmd.column] },
      },
    };
  }
  const empty = columns.length === 0 && row === null && cell === null;
  return {
    actions: [{ type: "CLEAR_SELECTION" }],
    outcome: { summary: "cleared the selection", undo: empty ? undefined : undo, touched: {} },
  };
}

function reduceAll(state: AppState, actions: AppAction[]): AppState {
  return actions.reduce(appReducer, state);
}

const fail = (id: string, error: string): Ack => ({ id, ok: false, error });

/** Why `cmd` cannot apply on the frame Studio shows now (null = it can). */
function staleReason(
  state: AppState,
  cmd: Extract<AgentCommand, { type: "propose_steps" }>,
): string | null {
  return state.workspace?.name === cmd.workspace &&
    currentIdentityKey(state) === cmd.base_identity
    ? null
    : "stale";
}

/** Step cards that are new or changed after a batch, plus the columns they act on. */
function stepsTouched(before: Step[], after: Step[]): Touched {
  const steps: number[] = [];
  const columns = new Set<string>();
  after.forEach((step, i) => {
    if (before.includes(step)) return;
    steps.push(i);
    const cols = step.params.columns;
    if (Array.isArray(cols)) cols.forEach((c) => typeof c === "string" && columns.add(c));
  });
  return { steps, columns: [...columns] };
}

async function proposeSteps(
  id: string,
  cmd: Extract<AgentCommand, { type: "propose_steps" }>,
  deps: BridgeDeps,
): Promise<Ack> {
  const check = (): Ack | null => {
    const state = deps.getState();
    const stale = staleReason(state, cmd);
    if (stale) return fail(id, stale);
    const out = applyStepOps(state.workspace?.steps ?? [], cmd.ops);
    return "error" in out ? fail(id, `bad_command: ${out.error}`) : null;
  };
  const refused = check();
  if (refused) return refused;

  const steps = deps.getState().workspace?.steps ?? [];
  const summary = summarizeOps(cmd.ops, steps);
  if (isDestructive(cmd.ops)) {
    const accepted = await deps.review({
      id,
      summary,
      lines: describeOps(cmd.ops, steps),
    });
    if (!accepted) return fail(id, "rejected");
    // The user may have changed the frame while the proposal waited.
    const late = check();
    if (late) return late;
  }

  const before = deps.getState().workspace?.steps ?? [];
  deps.dispatch({ type: "APPLY_STEP_BATCH", ops: cmd.ops });
  try {
    await deps.settle();
  } catch (e) {
    return fail(id, `save_failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  deps.touch(stepsTouched(before, deps.getState().workspace?.steps ?? []));
  deps.announce(summary, [{ type: "UNDO_STEPS" }]);
  return { id, ok: true, identity: currentIdentityKey(deps.getState()) };
}

/**
 * Run one relayed command and build its ack. Returns null when the command
 * carries no id (nothing to ack).
 */
export async function handleCommand(
  raw: unknown,
  deps: BridgeDeps,
): Promise<Ack | null> {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const id = raw.id;
  const cmd = parseCommand(raw);
  if ("error" in cmd) return fail(id, `bad_command: ${cmd.error}`);
  if (cmd.type === "propose_steps") return proposeSteps(id, cmd, deps);
  if (
    cmd.type === "set_target" ||
    cmd.type === "set_dist_by" ||
    cmd.type === "set_tool_params"
  ) {
    return setSetting(id, cmd, deps);
  }
  if (cmd.type === "pick_row" || cmd.type === "pick_cell" || cmd.type === "clear_selection") {
    return pick(id, cmd, deps);
  }
  const before = deps.getState();
  const actions = viewActions(cmd);
  return finish(id, deps, before, actions, viewOutcome(cmd, before));
}

/** Dispatch `actions`, highlight, announce and ack the identity after them. */
function finish(
  id: string,
  deps: BridgeDeps,
  before: AppState,
  actions: AppAction[],
  { summary, undo, touched }: Outcome,
): Ack {
  // Identity of the frame after these actions (pure replay, no render wait).
  const identity = currentIdentityKey(reduceAll(before, actions));
  for (const a of actions) deps.dispatch(a);
  deps.touch(touched);
  deps.announce(summary, undo);
  return { id, ok: true, identity };
}

/** set_target / set_dist_by / set_tool_params: validate against the frame / schema, then apply. */
async function setSetting(
  id: string,
  cmd: Extract<AgentCommand, { type: "set_target" | "set_dist_by" | "set_tool_params" }>,
  deps: BridgeDeps,
): Promise<Ack> {
  const named =
    cmd.type === "set_target" ? cmd.column : cmd.type === "set_dist_by" ? cmd.by : null;
  try {
    // Frame columns are fetched first; the state is read after the awaits.
    const columns = await deps.frameColumns();
    if (named !== null && !columns.includes(named)) {
      return fail(id, `bad_command: unknown column ${JSON.stringify(named)}`);
    }
    if (cmd.type === "set_tool_params") {
      const why = badToolParams(cmd, await deps.keySchema(toolDef(cmd.tool).key), columns);
      if (why) return fail(id, `bad_command: ${why}`);
    }
  } catch (e) {
    return fail(id, `frame_unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  const before = deps.getState();
  const { actions, outcome } = settingOutcome(cmd, before);
  return finish(id, deps, before, actions, outcome);
}

/**
 * pick_row / pick_cell / clear_selection. `column` is validated against the
 * frame shown. `rid` is not: rows load by pages, so Studio cannot tell cheaply
 * whether a rid is in the frame (dropped by a step, or on a page not loaded);
 * the selection is applied and the inspector shows its empty state.
 */
async function pick(
  id: string,
  cmd: Extract<AgentCommand, { type: "pick_row" | "pick_cell" | "clear_selection" }>,
  deps: BridgeDeps,
): Promise<Ack> {
  if (cmd.type === "pick_cell") {
    try {
      if (!(await deps.frameColumns()).includes(cmd.column)) {
        return fail(id, `bad_command: unknown column ${JSON.stringify(cmd.column)}`);
      }
    } catch (e) {
      return fail(id, `frame_unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const before = deps.getState();
  const { actions, outcome } = pickOutcome(cmd, before);
  return finish(id, deps, before, actions, outcome);
}
