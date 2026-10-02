import type { Step } from "../../../api/types";
import { TOOL_IDS, type ToolId } from "../../../state/dockTypes";
import type { AppAction } from "../../../state/reducer";
import type { StepOp } from "../../../state/stepOps";
import { toolDef } from "../../toolrail/tools";

/**
 * What a tool-call chip links to (datatoolkit-issues#67): the dock window or
 * the step(s) the call touched, derived from the MCP tool name and input, so
 * it works for every UI command without a per-tool engine field.
 */
export type ChipTarget =
  | { kind: "window"; tool: ToolId }
  | { kind: "steps"; ops: StepOp[] }
  | { kind: "columns"; columns: string[] }
  | null;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isToolId = (v: unknown): v is ToolId => TOOL_IDS.includes(v as ToolId);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

/** Tools whose window is implied by the tool name. */
const IMPLIED_WINDOW: Record<string, ToolId> = {
  set_dist_by: "dist",
  draft_chart: "chart",
  add_chart: "chart",
};

function stepOps(input: Obj): StepOp[] {
  return Array.isArray(input.ops) ? input.ops.filter(isObj).map((o) => o as unknown as StepOp) : [];
}

export function chipTarget(name: string, input: Obj): ChipTarget {
  if (name === "propose_steps") {
    const ops = stepOps(input);
    return ops.length ? { kind: "steps", ops } : null;
  }
  if (isToolId(input.tool)) return { kind: "window", tool: input.tool };
  if (IMPLIED_WINDOW[name]) return { kind: "window", tool: IMPLIED_WINDOW[name] };
  const columns = strings(input.columns);
  if (typeof input.column === "string") columns.push(input.column);
  return columns.length ? { kind: "columns", columns } : null;
}

function opLabel(op: StepOp): string {
  if ("add" in op) return `add ${op.add.step?.op ?? "step"}`;
  if ("replace" in op) return `edit step ${op.replace.index + 1}`;
  if ("remove" in op) return `remove step ${op.remove.index + 1}`;
  return "step";
}

/** Short chip text: "propose_steps · add scale", "open_window · Distribution". */
export function chipLabel(name: string, target: ChipTarget): string {
  if (!target) return name;
  switch (target.kind) {
    case "window":
      return `${name} · ${toolDef(target.tool)?.label ?? target.tool}`;
    case "steps":
      return `${name} · ${target.ops.map(opLabel).join(", ")}`;
    case "columns":
      return `${name} · ${target.columns.join(", ")}`;
  }
}

function lastIndex(steps: Step[], pred: (s: Step) => boolean): number {
  for (let i = steps.length - 1; i >= 0; i--) if (pred(steps[i]!)) return i;
  return -1;
}

const sameStep = (a: Step, b: Partial<Step>) =>
  a.op === b.op && JSON.stringify(a.params ?? {}) === JSON.stringify(b.params ?? {});

/**
 * Index of the steps a `propose_steps` call left in `steps` (now): a replaced
 * index as is, an added step = its last match (op + params, else op alone).
 * Removed steps have no card left to point at.
 */
export function stepIndices(ops: StepOp[], steps: Step[]): number[] {
  const found = new Set<number>();
  for (const op of ops) {
    if ("replace" in op && op.replace.index < steps.length) found.add(op.replace.index);
    if (!("add" in op) || !op.add.step) continue;
    const step = op.add.step;
    let at = lastIndex(steps, (s) => sameStep(s, step));
    if (at < 0) at = lastIndex(steps, (s) => s.op === step.op);
    if (at >= 0) found.add(at);
  }
  return [...found].sort((a, b) => a - b);
}

export interface ChipJump {
  actions: AppAction[];
  touch: { columns?: string[]; tools?: ToolId[]; steps?: number[] };
}

/** Reducer actions for a chip click (null = nothing left to show). */
export function chipJump(target: ChipTarget, steps: Step[]): ChipJump | null {
  if (!target) return null;
  switch (target.kind) {
    case "window":
      return { actions: [{ type: "OPEN_TOOL", id: target.tool }], touch: { tools: [target.tool] } };
    case "columns":
      return { actions: [], touch: { columns: target.columns } };
    case "steps": {
      const idx = stepIndices(target.ops, steps);
      if (!idx.length) return null;
      // Show the frame right after the (last) touched step.
      const version = Math.max(...idx) + 1;
      return {
        actions: [{ type: "SET_VIEW_VERSION", version: version >= steps.length ? null : version }],
        touch: { steps: idx },
      };
    }
  }
}
