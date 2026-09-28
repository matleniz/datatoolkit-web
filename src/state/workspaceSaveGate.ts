import { apiClient, serializeWorkspace } from "../api/client";
import type { Workspace } from "../api/types";

/**
 * Coordinates AppStore autosave vs delete/rename (MAT-149 / MAT-171 / MAT-217).
 *
 * A delete must always win over a debounced or in-flight PUT: bump the epoch,
 * tombstone deleted names, abort in-flight requests, and undo a PUT that still
 * landed after the tombstone was set.
 */

let saveEpoch = 0;
let lastSavedWorkspaceJson: string | null = null;
const suppressedNames = new Set<string>();
const inflightAborts = new Set<AbortController>();

export function getWorkspaceSaveEpoch(): number {
  return saveEpoch;
}

export function getLastSavedWorkspaceJson(): string | null {
  return lastSavedWorkspaceJson;
}

/** Call after an explicit saveWorkspace so AppStore skips a redundant PUT. */
export function markWorkspaceSaved(ws: Workspace): void {
  lastSavedWorkspaceJson = serializeWorkspace(ws);
  suppressedNames.delete(ws.name);
}

/** Clear a tombstone when the user intentionally selects/creates that name. */
export function allowWorkspaceSave(name: string): void {
  if (name) suppressedNames.delete(name);
}

export function isWorkspaceSaveSuppressed(name: string): boolean {
  return suppressedNames.has(name);
}

/**
 * Invalidate any pending / in-flight AppStore workspace PUT.
 * Pass `names` when deleting (or renaming away) so those workspaces cannot be
 * resurrected by a stale save.
 */
export function abandonPendingWorkspaceSave(
  names?: readonly string[],
): void {
  saveEpoch += 1;
  lastSavedWorkspaceJson = null;
  if (names) {
    for (const n of names) {
      if (n) suppressedNames.add(n);
    }
  }
  for (const ac of inflightAborts) {
    ac.abort();
  }
  inflightAborts.clear();
}

function beginWorkspaceSave(): AbortController {
  const ac = new AbortController();
  inflightAborts.add(ac);
  return ac;
}

function finishWorkspaceSave(ac: AbortController): void {
  inflightAborts.delete(ac);
}

export type WorkspaceSaveOutcome = "saved" | "skipped" | "undone";

/**
 * PUT a workspace only if the save generation is still current and the name
 * is not tombstoned. If a PUT still completes after abandon, delete again so
 * the delete remains authoritative (MAT-217).
 */
export async function commitWorkspaceSave(opts: {
  ws: Workspace;
  serialized: string;
  epochAtStart: number;
  isCurrent: (epochAtStart: number) => boolean;
  save: (ws: Workspace, signal: AbortSignal) => Promise<unknown>;
  remove: (name: string) => Promise<unknown>;
}): Promise<WorkspaceSaveOutcome> {
  const { ws, serialized, epochAtStart, isCurrent, save, remove } = opts;

  if (
    !isCurrent(epochAtStart) ||
    isWorkspaceSaveSuppressed(ws.name) ||
    serialized === lastSavedWorkspaceJson
  ) {
    return "skipped";
  }

  const ac = beginWorkspaceSave();
  try {
    if (
      !isCurrent(epochAtStart) ||
      isWorkspaceSaveSuppressed(ws.name) ||
      ac.signal.aborted
    ) {
      return "skipped";
    }

    await save(ws, ac.signal);

    if (!isCurrent(epochAtStart) || isWorkspaceSaveSuppressed(ws.name)) {
      if (isWorkspaceSaveSuppressed(ws.name)) {
        try {
          await remove(ws.name);
        } catch {
          /* best-effort undo; list refresh will surface leftovers */
        }
        return "undone";
      }
      return "skipped";
    }

    lastSavedWorkspaceJson = serialized;
    return "saved";
  } catch {
    // Abort (or engine error) after the request may still have hit the
    // server — if this name is tombstoned, delete again so delete wins.
    if (isWorkspaceSaveSuppressed(ws.name)) {
      try {
        await remove(ws.name);
      } catch {
        /* already gone or engine error */
      }
      return "undone";
    }
    return "skipped";
  } finally {
    finishWorkspaceSave(ac);
  }
}

/** @internal vitest helper — reset module state between cases. */
export function resetWorkspaceSaveGateForTests(): void {
  saveEpoch = 0;
  lastSavedWorkspaceJson = null;
  suppressedNames.clear();
  for (const ac of inflightAborts) {
    ac.abort();
  }
  inflightAborts.clear();
  saveChain = Promise.resolve();
  committedWorkspace = null;
}

/** Workspace of the current React commit (set in a layout effect, before any
 *  passive effect of the same commit runs) — MAT-175. */
let committedWorkspace: Workspace | null = null;
let saveChain: Promise<void> = Promise.resolve();

export function setCommittedWorkspace(ws: Workspace | null): void {
  committedWorkspace = ws;
}

export function saveable(ws: Workspace | null): ws is Workspace {
  return !!ws?.name && !!ws.datasets.train.x.path;
}

/**
 * Chain-queue a `commitWorkspaceSave` so PUTs run in order and the engine
 * store always ends on the latest request. A newer commit for the same name
 * supersedes an older queued one (its own save follows).
 */
function queueWorkspaceSave(
  ws: Workspace,
  epochAtStart: number = saveEpoch,
): Promise<void> {
  const serialized = serializeWorkspace(ws);
  const run = saveChain.then(async () => {
    if (
      committedWorkspace &&
      committedWorkspace.name === ws.name &&
      serializeWorkspace(committedWorkspace) !== serialized
    ) {
      return;
    }
    await commitWorkspaceSave({
      ws,
      serialized,
      epochAtStart,
      isCurrent: (e) => e === saveEpoch,
      save: (body, signal) => apiClient.saveWorkspace(body, signal),
      remove: (name) => apiClient.deleteWorkspace(name),
    });
  });
  saveChain = run;
  return run;
}

/**
 * Resolve once the engine store holds `ws` (MAT-175). Analysis keys read the
 * named workspace from the store (`{kind:"dataset"}` sources), so every
 * consumer awaits this before `run_key`. Unlike the debounced
 * `__DTK_WORKSPACE_SAVED__` gate, it cannot observe the previous commit's
 * (already resolved) promise: child effects run before the provider's.
 * Honours the same tombstone / epoch rules as the debounced autosave.
 */
export function ensureWorkspaceSaved(ws: Workspace | null): Promise<void> {
  if (!saveable(ws)) return Promise.resolve();
  if (serializeWorkspace(ws) === lastSavedWorkspaceJson) {
    return saveChain;
  }
  return queueWorkspaceSave(ws);
}

/** @internal AppStore's debounced-save effect reuses the same chain/queue. */
export { queueWorkspaceSave };
