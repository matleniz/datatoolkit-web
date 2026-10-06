import type { Step, WorkspaceNotes } from "../api/types";

/** What one undo level restores: the steps and the notes (#152). */
export interface PipelineSnapshot {
  steps: Step[];
  notes: WorkspaceNotes | undefined;
}

/**
 * Undo / redo over the pipeline (datatoolkit-issues#16): snapshots of
 * `workspace.steps` and `workspace.notes`, in memory, per open workspace.
 */
export interface StepHistory<T = PipelineSnapshot> {
  past: T[];
  future: T[];
}

export const EMPTY_STEP_HISTORY: StepHistory<never> = { past: [], future: [] };

/** Undo levels kept; the oldest snapshot is dropped beyond this. */
export const MAX_STEP_HISTORY = 100;

/** Same steps: same length and the same Step objects in order. */
export function sameSteps(a: Step[], b: Step[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** A new change: `before` becomes undoable, the redo branch is dropped. */
export function recordSteps<T>(history: StepHistory<T>, before: T): StepHistory<T> {
  return {
    past: [...history.past, before].slice(-MAX_STEP_HISTORY),
    future: [],
  };
}

/** Steps to restore and the history after an undo; null when nothing to undo. */
export function undoSteps<T>(
  history: StepHistory<T>,
  current: T,
): { steps: T; history: StepHistory<T> } | null {
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
export function redoSteps<T>(
  history: StepHistory<T>,
  current: T,
): { steps: T; history: StepHistory<T> } | null {
  const [steps, ...future] = history.future;
  if (!steps) return null;
  return {
    steps,
    history: { past: [...history.past, current], future },
  };
}
