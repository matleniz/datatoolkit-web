import type { Step } from "../api/types";

/**
 * One edit of a step batch (agent bridge, datatoolkit-issues#63). Ops apply
 * in order: an index refers to the list as the previous ops left it.
 */
export type StepOp =
  | { add: { step: Step } }
  | { replace: { index: number; step: Step } }
  | { remove: { index: number } };

/** Keep `align: true` steps first (prototype / FRONT-WEB alignment rule). */
export function orderSteps(steps: Step[]): Step[] {
  const align = steps.filter((s) => s.align);
  const rest = steps.filter((s) => !s.align);
  return [...align, ...rest];
}

/**
 * Steps after applying `ops`, or `{ error }` when one op is invalid (index out
 * of range). Same rules as ADD_STEP / REPLACE_STEP (keeps the `align` flag) /
 * REMOVE_STEP; `orderSteps` runs once at the end.
 */
export function applyStepOps(
  steps: Step[],
  ops: StepOp[],
): { steps: Step[] } | { error: string } {
  const next = steps.slice();
  for (const [n, op] of ops.entries()) {
    if ("add" in op) {
      next.push(op.add.step);
    } else if ("replace" in op) {
      const { index, step } = op.replace;
      const old = next[index];
      if (!old) return { error: `op ${n}: no step at index ${index}` };
      const { align: _drop, ...rest } = step;
      next[index] = old.align ? { ...rest, align: true } : rest;
    } else {
      const { index } = op.remove;
      if (!Number.isInteger(index) || index < 0 || index >= next.length) {
        return { error: `op ${n}: no step at index ${index}` };
      }
      next.splice(index, 1);
    }
  }
  return { steps: orderSteps(next) };
}
