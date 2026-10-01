import type { ChartSpec } from "../api/types";

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

/** Front-side chart persistence until engine Workspace.charts (MAT-185). */
function loadStoredCharts(workspaceName: string): ChartSpec[] {
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

export function saveStoredCharts(
  workspaceName: string,
  charts: ChartSpec[],
): void {
  try {
    localStorage.setItem(keyFor(workspaceName), JSON.stringify(charts));
  } catch {
    /* private mode / quota */
  }
}

/** Merge engine workspace with locally stored charts when engine has none. */
export function hydrateWorkspaceCharts<
  T extends { name: string; charts?: ChartSpec[] },
>(ws: T): T {
  const existing = ws.charts ?? [];
  if (existing.length > 0) return ws;
  const stored = loadStoredCharts(ws.name);
  if (stored.length === 0) return { ...ws, charts: [] };
  return { ...ws, charts: stored };
}
