import type { Step } from "../api/types";
import { withNote } from "./notes";
import { withNewId } from "./stepIds";
import { groupSteps, insertStep, orderList, removeStepAt, replaceStepAt, type GroupMeta, type StepList } from "./stepGroups";

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

/**
 * The step list after applying `ops`, or `{ error }` when one op is invalid
 * (no such step). Same rules as ADD_STEP (a new step gets a fresh id unless
 * it carries one) / REPLACE_STEP (keeps the `align` flag, the id and, unless
 * the new step sets one, the note) / REMOVE_STEP; the groups follow each op
 * (`stepGroups.ts`: an added step is a singleton group, a removed one leaves
 * its group) and `orderList` (align steps first) runs once at the end.
 *
 * With `group`, the steps the batch ADDS become one group (one action = one
 * group, #249). A replaced step keeps its id and so its own group; a batch
 * that adds nothing, or whose added steps do not end up side by side, makes no
 * group (they stay singletons).
 */
export function applyStepOps(
  list: StepList,
  ops: StepOp[],
  group?: GroupMeta,
): StepList | { error: string } {
  let next = list;
  const added: string[] = [];
  for (const [n, op] of ops.entries()) {
    if ("add" in op) {
      const step = withNewId(op.add.step, next.steps);
      next = insertStep(next, step);
      if (step.id) added.push(step.id);
      continue;
    }
    const ref = opRef(op)!;
    const at = refIndex(next.steps, ref);
    if (at < 0) return { error: `op ${n}: no step ${refText(ref)}` };
    if ("replace" in op) {
      const old = next.steps[at]!;
      const { align: _drop, id: _id, ...rest } = op.replace.step;
      // The note follows the slot unless the new step sets one (#152).
      const note = "note" in op.replace.step ? op.replace.step.note : old.note;
      next = replaceStepAt(
        next,
        at,
        withNote(
          {
            ...(old.id ? { id: old.id } : {}),
            ...rest,
            ...(old.align ? { align: true } : {}),
          },
          note,
        ),
      );
    } else {
      next = removeStepAt(next, at);
    }
  }
  const ordered = orderList(next);
  if (!group) return ordered;
  // Steps a later op of the same batch removed are gone.
  const alive = added.filter((id) => ordered.steps.some((s) => s.id === id));
  if (alive.length === 0) return ordered;
  const grouped = groupSteps(ordered, alive, group);
  return "error" in grouped ? ordered : grouped;
}
