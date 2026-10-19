import type { Group, Step } from "../../api/types";
import { fillSingletons } from "../../state/stepGroups";

/**
 * View-model of the grouped step list (datatoolkit-issues#249, PR B): one row
 * per group, over the flat steps. Pure, so it is unit-tested without React.
 */
export interface GroupRow {
  group: Group;
  /** Index in `steps` of the first step of the group. */
  start: number;
  /** Number of steps in the group. */
  count: number;
  /** Steps of the group applied at the viewed version (0..count). */
  applied: number;
  /** The viewed version falls inside the group: some steps applied, not all. */
  partial: boolean;
  /**
   * A group of one step renders as today's step row, with no group chrome;
   * only a group of several steps gets a header.
   */
  singleton: boolean;
}

/** The group rows for `steps` viewed at `version` (a count of applied steps). */
export function groupRows(steps: Step[], groups: Group[], version: number): GroupRow[] {
  const rows: GroupRow[] = [];
  let start = 0;
  for (const group of fillSingletons(steps, groups)) {
    const count = group.step_ids.length;
    const applied = Math.max(0, Math.min(count, version - start));
    rows.push({ group, start, count, applied, partial: applied > 0 && applied < count, singleton: count === 1 });
    start += count;
  }
  return rows;
}

/** The version a group-level select lands on: after the last step of the group. */
export function groupEndVersion(row: GroupRow): number {
  return row.start + row.count;
}

/** Subtle origin marker of a header: only a manual group or a named producer has one. */
export function originLabel(group: Group): string | null {
  if (group.produced_by) return group.produced_by;
  return group.origin === "manual" ? "manual" : null;
}

/** "6 steps", or "3 of 6 steps applied" when the viewed version cuts the group. */
export function groupCountLabel(row: GroupRow): string {
  return row.partial ? `${row.applied} of ${row.count} steps applied` : `${row.count} steps`;
}

/** `expanded` flipped for `id`; a new set, never the same one. */
export function toggleExpanded(expanded: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expanded);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** `expanded` without the ids no group has any more; the same set when nothing goes. */
export function pruneExpanded(expanded: ReadonlySet<string>, groups: Group[]): ReadonlySet<string> {
  if (expanded.size === 0) return expanded;
  const live = new Set(groups.map((g) => g.id));
  const kept = [...expanded].filter((id) => live.has(id));
  return kept.length === expanded.size ? expanded : new Set(kept);
}
