import type { ChartSpec } from "../api/types";

/**
 * Legacy browser copy of saved charts (`localStorage["dtk.charts.<name>"]`),
 * written before the engine stored `Workspace.charts` (MAT-185). Read once to
 * migrate into the workspace, dropped after the next successful save.
 */
const keyFor = (workspaceName: string) => `dtk.charts.${workspaceName}`;

function isChartSpec(value: unknown): value is ChartSpec {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    o.name.length > 0 &&
    typeof o.params === "object" &&
    o.params !== null &&
    !Array.isArray(o.params)
  );
}

function loadLegacyCharts(workspaceName: string): ChartSpec[] {
  try {
    const raw = localStorage.getItem(keyFor(workspaceName));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChartSpec);
  } catch {
    return [];
  }
}

/** Forget the legacy copy once the engine holds this workspace's charts. */
export function dropLegacyCharts(workspaceName: string): void {
  try {
    localStorage.removeItem(keyFor(workspaceName));
  } catch {
    /* private mode */
  }
}

/**
 * Charts of a loaded workspace: the engine's when it has any, else the legacy
 * browser copy (one-time migration; the next PUT stores them on the engine).
 */
export function hydrateWorkspaceCharts<
  T extends { name: string; charts?: ChartSpec[] },
>(ws: T): T {
  const existing = ws.charts ?? [];
  if (existing.length > 0) return ws;
  return { ...ws, charts: loadLegacyCharts(ws.name) };
}
