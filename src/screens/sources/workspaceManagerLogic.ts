/**
 * Pure helpers for the Sources workspace manager (MAT-171).
 * Summaries come from GET /workspaces/summaries — do not recompute store logic.
 */

import { fmtCount } from "../../bench/format";
import type { WorkspaceRoleSummary, WorkspaceSummary } from "../../api/types";

export type WorkspaceSortKey = "name" | "mtime";
export type WorkspaceSortDir = "asc" | "desc";

export function formatShape(
  shape: [number, number] | null | undefined,
): string {
  if (!shape || shape.length < 2) return "—";
  return `${fmtCount(shape[0])} × ${fmtCount(shape[1])}`;
}

export function formatMtime(iso: string, nowMs = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diffSec = Math.round((nowMs - t) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return `${m}m ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return `${h}h ago`;
  }
  if (diffSec < 86400 * 14) {
    const d = Math.floor(diffSec / 86400);
    return `${d}d ago`;
  }
  try {
    return new Date(t).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function roleLine(role: WorkspaceRoleSummary | null): string {
  if (!role) return "no test";
  const file = role.file || "(empty)";
  const shape = formatShape(role.shape);
  return `${file} · ${shape}`;
}

export function filterWorkspaceSummaries(
  summaries: WorkspaceSummary[],
  query: string,
): WorkspaceSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return summaries;
  return summaries.filter((s) => {
    if (s.name.toLowerCase().includes(q)) return true;
    if (s.target?.toLowerCase().includes(q)) return true;
    if (s.train.file?.toLowerCase().includes(q)) return true;
    if (s.test?.file?.toLowerCase().includes(q)) return true;
    return false;
  });
}

export function sortWorkspaceSummaries(
  summaries: WorkspaceSummary[],
  key: WorkspaceSortKey,
  dir: WorkspaceSortDir,
): WorkspaceSummary[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...summaries].sort((a, b) => {
    if (key === "name") {
      return mul * a.name.localeCompare(b.name);
    }
    const at = Date.parse(a.mtime);
    const bt = Date.parse(b.mtime);
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return mul * (at - bt);
  });
}

/** Suggest a free duplicate name: `name-copy`, `name-copy-2`, … */
export function suggestDuplicateName(
  name: string,
  existing: Iterable<string>,
): string {
  const taken = new Set(existing);
  const base = `${name}-copy`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export function deleteConfirmMessage(summary: WorkspaceSummary): string {
  const steps = summary.step_count;
  const stepBit =
    steps === 0
      ? "no steps"
      : `${steps} step${steps === 1 ? "" : "s"}`;
  const targetBit = summary.target
    ? ` Target “${summary.target}”.`
    : "";
  return (
    `Delete workspace “${summary.name}”? This removes the workspace config, ` +
    `${stepBit}, and its train/test bindings.${targetBit} ` +
    `Uploaded files stay on disk (content-addressed; they may be shared).`
  );
}

export function multiDeleteConfirmMessage(names: string[]): string {
  const list = names.map((n) => `“${n}”`).join(", ");
  return (
    `Delete ${names.length} workspace${names.length === 1 ? "" : "s"} (${list})? ` +
    `This removes each workspace’s config, steps, and train/test bindings. ` +
    `Uploaded files stay on disk (content-addressed; they may be shared).`
  );
}

/** Pick a fallback after deleting the active workspace (prefer churn, else first). */
export function pickFallbackWorkspace(
  remaining: string[],
  preferred?: string | null,
): string | null {
  if (remaining.length === 0) return null;
  if (preferred && remaining.includes(preferred)) return preferred;
  if (remaining.includes("churn")) return "churn";
  return [...remaining].sort((a, b) => a.localeCompare(b))[0] ?? null;
}
