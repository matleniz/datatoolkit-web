import { EngineError } from "../api/types";
import type { ColumnProfile, ColumnProfiles, Workspace } from "../api/types";

export function latestVersion(ws: Workspace): number {
  return ws.steps.length;
}

/**
 * Fingerprint of workspace parts that affect pipeline shapes.
 * Variables and view version are intentionally excluded.
 */
export function shapesStructureKey(
  ws: Workspace | null,
  role: string,
): string {
  if (!ws) return `${role}|`;
  return JSON.stringify({
    role,
    steps: ws.steps,
    datasets: ws.datasets,
    merges: ws.merges ?? [],
    label: ws.label,
  });
}

/** Resolve viewVersion (null = latest) to an engine version index. */
export function effectiveVersion(
  ws: Workspace,
  viewVersion: number | null,
): number {
  const last = latestVersion(ws);
  if (viewVersion === null || viewVersion > last) return last;
  if (viewVersion < 0) return 0;
  return viewVersion;
}

/** Accept both `{columns, version}` and a bare profile array. */
export function normalizeProfiles(raw: unknown): ColumnProfiles {
  if (Array.isArray(raw)) {
    return { columns: raw as ColumnProfile[], version: 0 };
  }
  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as ColumnProfiles).columns)
  ) {
    const r = raw as ColumnProfiles;
    return { columns: r.columns, version: r.version ?? 0 };
  }
  throw new EngineError(
    "ParseError",
    "column_profiles response missing columns[]",
  );
}
