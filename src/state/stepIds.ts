import type { Step } from "../api/types";

/**
 * Stable step ids (datatoolkit-issues#153). An id names a step slot: minted by
 * whoever creates the step, kept by a replace / an editor apply / undo, gone
 * with the step. Opaque: never parse it.
 */

/** A fresh id: `s` + 8 random lowercase hex chars, not in `taken`. */
export function newStepId(taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const id = `s${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    if (!used.has(id)) return id;
  }
}

/**
 * Steps with every missing id filled by the engine's migration rule:
 * `s<position>` (1-based), `-2`, `-3`… on a clash. Deterministic, so Studio
 * and the engine agree on a workspace stored before ids. Same array when
 * nothing is missing.
 */
export function fillStepIds(steps: Step[]): Step[] {
  if (steps.every((s) => s.id)) return steps;
  const taken = new Set(steps.flatMap((s) => (s.id ? [s.id] : [])));
  return steps.map((step, i) => {
    if (step.id) return step;
    let id = `s${i + 1}`;
    for (let n = 2; taken.has(id); n++) id = `s${i + 1}-${n}`;
    taken.add(id);
    return { ...step, id };
  });
}

/**
 * A step created now, joining `steps`: its own id when it has a free one,
 * else a fresh id (a copy of an existing step must not share its id).
 */
export function withNewId(step: Step, steps: Step[]): Step {
  const taken = steps.flatMap((s) => (s.id ? [s.id] : []));
  return step.id && !taken.includes(step.id) ? step : { ...step, id: newStepId(taken) };
}
