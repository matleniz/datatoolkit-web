import type { Step } from "../api/types";

/**
 * Undo / redo over the pipeline's steps only (datatoolkit-issues#16):
 * snapshots of `workspace.steps`, in memory, per open workspace.
 */
export interface StepHistory {
  past: Step[][];
  future: Step[][];
}

export const EMPTY_STEP_HISTORY: StepHistory = { past: [], future: [] };

/** Undo levels kept; the oldest snapshot is dropped beyond this. */
export const MAX_STEP_HISTORY = 100;

/** Same steps: same length and the same Step objects in order. */
export function sameSteps(a: Step[], b: Step[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** A new change: `before` becomes undoable, the redo branch is dropped. */
export function recordSteps(history: StepHistory, before: Step[]): StepHistory {
  return {
    past: [...history.past, before].slice(-MAX_STEP_HISTORY),
    future: [],
  };
}

/** Steps to restore and the history after an undo; null when nothing to undo. */
export function undoSteps(
  history: StepHistory,
  current: Step[],
): { steps: Step[]; history: StepHistory } | null {
  const steps = history.past.at(-1);
  if (!steps) return null;
  return {
    steps,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future],
    },
  };
}

/** Steps to restore and the history after a redo; null when nothing to redo. */
export function redoSteps(
  history: StepHistory,
  current: Step[],
): { steps: Step[]; history: StepHistory } | null {
  const [steps, ...future] = history.future;
  if (!steps) return null;
  return {
    steps,
    history: { past: [...history.past, current], future },
  };
}
