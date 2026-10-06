import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import type { ColumnNotes, Role, Workspace } from "../../api/types";
import { effectiveVersion } from "../version";

const NONE: ColumnNotes = { notes: {}, keys: {} };

/**
 * Column notes by the names shown at the viewed version (datatoolkit-issues#152).
 * The engine traces renames (`/workspace/column-notes`); no request while the
 * workspace has no column note, so a rename only matters once one exists.
 */
export function useColumnNotes(
  workspace: Workspace | null,
  role: Role,
  viewVersion: number | null,
): ColumnNotes {
  const [result, setResult] = useState<{ name: string; notes: ColumnNotes } | null>(null);
  const hasNotes = Object.keys(workspace?.notes?.columns ?? {}).length > 0;
  const version = workspace ? effectiveVersion(workspace, viewVersion) : 0;
  // Renames live in the steps up to `version`: refetch when those or the notes change.
  const key = useMemo(
    () =>
      workspace && hasNotes
        ? JSON.stringify([
            workspace.name,
            role,
            version,
            workspace.steps.slice(0, version).map((s) => [s.op, s.target, s.params]),
            workspace.notes,
          ])
        : "",
    [workspace, hasNotes, role, version],
  );

  useEffect(() => {
    if (!key || !workspace) return;
    let live = true;
    apiClient
      .columnNotes(workspace, role, version)
      .then((notes) => live && setResult({ name: workspace.name, notes }))
      .catch(() => live && setResult({ name: workspace.name, notes: NONE }));
    return () => {
      live = false;
    };
    // `key` covers what the request depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // While a refetch runs, the previous answer for this workspace stays shown.
  return key && result && result.name === workspace?.name ? result.notes : NONE;
}
