import type { Step } from "../api/types";
import { withNote } from "./notes";
import { withNewId } from "./stepIds";

/**
 * Which step an op targets: its stable id (datatoolkit-issues#153), or its
 * index in the list as the previous ops left it (older form).
 */
export type StepRef = { index: number } | { id: string };

/**
 * One edit of a step batch (agent bridge, datatoolkit-issues#63). Ops apply
 * in order.
 */
export type StepOp =
  | { add: { step: Step } }
  | { replace: StepRef & { step: Step } }
  | { remove: StepRef };

/** The step ref of a replace / remove op (null for an add). */
export function opRef(op: StepOp): StepRef | null {
  if ("add" in op) return null;
  return "replace" in op ? op.replace : op.remove;
}

/** Index of `ref` in `steps`, -1 when no step matches. */
export function refIndex(steps: Step[], ref: StepRef): number {
  if ("id" in ref) return steps.findIndex((s) => s.id === ref.id);
  return Number.isInteger(ref.index) && ref.index >= 0 && ref.index < steps.length
    ? ref.index
    : -1;
}

/** "s3" / "at index 2", for error lines. */
const refText = (ref: StepRef) => ("id" in ref ? ref.id : `at index ${ref.index}`);

/** Keep `align: true` steps first (prototype / FRONT-WEB alignment rule). */
export function orderSteps(steps: Step[]): Step[] {
  const align = steps.filter((s) => s.align);
  const rest = steps.filter((s) => !s.align);
  return [...align, ...rest];
}

/**
 * Steps after applying `ops`, or `{ error }` when one op is invalid (no such
 * step). Same rules as ADD_STEP (a new step gets a fresh id unless it carries
 * one) / REPLACE_STEP (keeps the `align` flag, the id and, unless the new
 * step sets one, the note) / REMOVE_STEP;
 * `orderSteps` runs once at the end.
 */
export function applyStepOps(
  steps: Step[],
  ops: StepOp[],
): { steps: Step[] } | { error: string } {
  const next = steps.slice();
  for (const [n, op] of ops.entries()) {
    if ("add" in op) {
      next.push(withNewId(op.add.step, next));
      continue;
    }
    const ref = opRef(op)!;
    const at = refIndex(next, ref);
    if (at < 0) return { error: `op ${n}: no step ${refText(ref)}` };
    if ("replace" in op) {
      const old = next[at]!;
      const { align: _drop, id: _id, ...rest } = op.replace.step;
      // The note follows the slot unless the new step sets one (#152).
      const note = "note" in op.replace.step ? op.replace.step.note : old.note;
      next[at] = withNote(
        {
          ...(old.id ? { id: old.id } : {}),
          ...rest,
          ...(old.align ? { align: true } : {}),
        },
        note,
      );
    } else {
      next.splice(at, 1);
    }
  }
  return { steps: orderSteps(next) };
}
