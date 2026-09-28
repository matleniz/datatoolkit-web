/** Pure path helpers for the export manifest summary. */

import type { Workspace } from "../../api/types";

export function isAbsolutePath(p: string): boolean {
  return (
    p.startsWith("/") ||
    p.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(p)
  );
}

/**
 * Default export out_dir: absolute path under the engine home when the
 * workspace source lives in `$DTK_HOME/uploads/…`, else `/tmp/exports/<name>`.
 * Derived only from workspace paths (no extra API round-trip).
 */
export function defaultExportOutDir(workspace: Workspace): string {
  const src = workspace.datasets.train.x.path?.trim() ?? "";
  if (isAbsolutePath(src)) {
    const norm = src.replace(/\\/g, "/");
    const idx = norm.lastIndexOf("/uploads/");
    if (idx >= 0) {
      const home = norm.slice(0, idx);
      if (home) return `${home}/exports/${workspace.name}`;
    }
  }
  return `/tmp/exports/${workspace.name}`;
}

/**
 * If `path` is `<out_dir>/processed/<file>`, return `out_dir`.
 * Handles both `/` and `\` separators.
 */
export function outDirFromProcessedPath(path: string): string | null {
  const m = path.match(/^(.*)[/\\]processed[/\\][^/\\]+$/);
  const dir = m?.[1];
  if (dir == null || dir === "") return null;
  return dir;
}

/**
 * Resolve the export output directory for display.
 * Prefer the absolute dir the user exported to; if that value was relative,
 * derive the absolute dir as the parent of `processed/` from an output path.
 */
export function resolveExportOutDir(
  requestedOutDir: string,
  outputPaths: string[],
): string {
  const requested = requestedOutDir.trim().replace(/[/\\]+$/, "");
  if (isAbsolutePath(requested)) {
    return requested;
  }
  for (const p of outputPaths) {
    const derived = outDirFromProcessedPath(p);
    if (derived != null) return derived;
  }
  return requested;
}

/** `<out_dir>/manifest.json` (engine writes the manifest there last). */
export function joinManifestPath(outDir: string): string {
  const trimmed = outDir.replace(/[/\\]+$/, "");
  const sep = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  return `${trimmed}${sep}manifest.json`;
}
