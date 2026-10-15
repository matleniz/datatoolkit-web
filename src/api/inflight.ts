/**
 * In-flight request tracker (datatoolkit-issues#247): the API client reports
 * each cancellable request under a scope, so the panels can show a busy state
 * and a Cancel without every call site plumbing its own flag.
 *
 * Scopes: `source` = opening / inspecting / previewing a dataset and uploads
 * (Sources screen); `frame` = grid rows, profiles and step previews (step list
 * and preview). Saves are not tracked: they are not cancellable (the autosave
 * banner reports their failures).
 */
export type BusyScope = "source" | "frame";

interface Entry {
  scope: BusyScope;
  abort: () => void;
}

const entries = new Set<Entry>();
const counts: Record<BusyScope, number> = { source: 0, frame: 0 };
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of [...listeners]) l();
}

/** Scope of an engine call by method + path; null = not tracked. */
export function scopeOf(method: string, path: string): BusyScope | null {
  if (method === "GET") {
    return /^\/workspaces\/[^/]+$/.test(path) && path !== "/workspaces/summaries"
      ? "source"
      : null;
  }
  if (method === "PUT" && path.startsWith("/uploads/")) return "source";
  if (method !== "POST") return null;
  if (path === "/source/columns" || path === "/workspace/preview") return "source";
  if (/^\/keys\/[^/]+\/run$/.test(path)) return "source";
  if (
    path === "/workspace/rows" ||
    path === "/workspace/profiles" ||
    path === "/workspace/preview-step"
  ) {
    return "frame";
  }
  return null;
}

/** Register a request; returns the function to call when it settles. */
export function trackRequest(scope: BusyScope, abort: () => void): () => void {
  const entry: Entry = { scope, abort };
  entries.add(entry);
  counts[scope] += 1;
  notify();
  return () => {
    if (!entries.delete(entry)) return;
    counts[scope] -= 1;
    notify();
  };
}

/** Number of tracked requests currently on the wire for `scope`. */
export function inFlightCount(scope: BusyScope): number {
  return counts[scope];
}

export function subscribeInFlight(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Abort every tracked request of `scope`; their callers see a `Cancelled` error. */
export function cancelInFlight(scope: BusyScope): void {
  for (const e of [...entries]) if (e.scope === scope) e.abort();
}
