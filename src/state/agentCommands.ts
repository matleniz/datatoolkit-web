import type { Role, Step } from "../api/types";
import { TOOL_IDS, type ToolId } from "./dockTypes";
import { appReducer, type AppAction, type AppState } from "./reducer";
import { applyStepOps, type StepOp } from "./stepOps";
import { currentIdentityKey } from "./uiContext";
import { PER_COLUMN_PARAM_TOOLS, toolParamsKey } from "../bench/left/keyTunable";

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
  | { type: "set_view"; role?: Role; version?: number | null };

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
  /** Applied-at-once notice with an Undo button. */
  announce(summary: string): void;
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

/** Actions of a non-step command (open_window / select_columns / set_view). */
function viewActions(
  cmd: Exclude<AgentCommand, { type: "propose_steps" }>,
): AppAction[] {
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

  deps.dispatch({ type: "APPLY_STEP_BATCH", ops: cmd.ops });
  try {
    await deps.settle();
  } catch (e) {
    return fail(id, `save_failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  deps.announce(summary);
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
  const actions = viewActions(cmd);
  // Identity of the frame after these actions (pure replay, no render wait).
  const identity = currentIdentityKey(reduceAll(deps.getState(), actions));
  for (const a of actions) deps.dispatch(a);
  return { id, ok: true, identity };
}
