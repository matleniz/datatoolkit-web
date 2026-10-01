import { apiClient, serializeWorkspace } from "../api/client";
import type { Workspace } from "../api/types";
import { dropLegacyCharts } from "./chartStorage";

/**
 * Coordinates AppStore autosave vs delete/rename (MAT-149 / MAT-171 / MAT-217,
 * datatoolkit-issues#13).
 *
 * A delete must always win over a debounced or in-flight PUT: tombstone the
 * deleted names so no queued save runs for them, wait for the PUT already on
 * the wire to get its answer before deleting (an aborted fetch can still be
 * applied by the engine after the DELETE), and undo a PUT that still landed
 * for a tombstoned name.
 */

let saveEpoch = 0;
let lastSavedWorkspaceJson: string | null = null;
const suppressedNames = new Set<string>();
/** Every gate PUT runs on this chain, one at a time, in request order. */
let saveChain: Promise<void> = Promise.resolve();

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
  dropLegacyCharts(ws.name);
}

/**
 * Call with a workspace just read from the engine store, so AppStore does not
 * PUT the same JSON straight back (#13: that echo PUT was still pending when
 * the user deleted the workspace). Unlike `markWorkspaceSaved`, a tombstone
 * set meanwhile (deleted while loading) stays.
 */
export function markWorkspaceLoaded(ws: Workspace): void {
  lastSavedWorkspaceJson = serializeWorkspace(ws);
}

/** Clear a tombstone when the user intentionally selects/creates that name. */
export function allowWorkspaceSave(name: string): void {
  if (name) suppressedNames.delete(name);
}

export function isWorkspaceSaveSuppressed(name: string): boolean {
  return suppressedNames.has(name);
}

/**
 * Cancel pending AppStore workspace PUTs.
 *
 * With `names` (delete, rename away): tombstone those names, so no debounced
 * or queued save can resurrect them; saves of other workspaces go on.
 * Without: bump the epoch, dropping every pending save.
 *
 * Resolves once the save already on the wire (if any) has its answer: await
 * it before DELETE so the engine cannot apply that PUT after the delete. A
 * PUT that lands for a tombstoned name is then undone (`commitWorkspaceSave`).
 */
export function abandonPendingWorkspaceSave(
  names?: readonly string[],
): Promise<void> {
  if (names) {
    for (const n of names) {
      if (n) suppressedNames.add(n);
    }
  } else {
    saveEpoch += 1;
    lastSavedWorkspaceJson = null;
  }
  return saveChain;
}

export type WorkspaceSaveOutcome = "saved" | "skipped" | "undone";

/**
 * PUT a workspace only if the save generation is still current and the name
 * is not tombstoned. If a PUT still completes after the name was tombstoned,
 * delete again so the delete remains authoritative (MAT-217).
 */
export async function commitWorkspaceSave(opts: {
  ws: Workspace;
  serialized: string;
  epochAtStart: number;
  isCurrent: (epochAtStart: number) => boolean;
  save: (ws: Workspace) => Promise<unknown>;
  remove: (name: string) => Promise<unknown>;
  /** Reject with the save error instead of reporting "skipped". */
  rethrow?: boolean;
}): Promise<WorkspaceSaveOutcome> {
  const { ws, serialized, epochAtStart, isCurrent, save, remove } = opts;

  if (
    !isCurrent(epochAtStart) ||
    isWorkspaceSaveSuppressed(ws.name) ||
    serialized === lastSavedWorkspaceJson
  ) {
    return "skipped";
  }

  try {
    await save(ws);
  } catch (e) {
    if (opts.rethrow && !isWorkspaceSaveSuppressed(ws.name)) throw e;
    return "skipped";
  }

  if (isWorkspaceSaveSuppressed(ws.name)) {
    try {
      await remove(ws.name);
    } catch {
      /* already gone (the delete ran after us); list refresh shows leftovers */
    }
    return "undone";
  }
  if (!isCurrent(epochAtStart)) return "skipped";

  lastSavedWorkspaceJson = serialized;
  dropLegacyCharts(ws.name);
  return "saved";
}

/** @internal vitest helper — reset module state between cases. */
export function resetWorkspaceSaveGateForTests(): void {
  saveEpoch = 0;
  lastSavedWorkspaceJson = null;
  suppressedNames.clear();
  saveChain = Promise.resolve();
  committedWorkspace = null;
}

/** Workspace of the current React commit (set in a layout effect, before any
 *  passive effect of the same commit runs) — MAT-175. */
let committedWorkspace: Workspace | null = null;

export function setCommittedWorkspace(ws: Workspace | null): void {
  committedWorkspace = ws;
}

export function saveable(ws: Workspace | null): ws is Workspace {
  return !!ws?.name && !!ws.datasets.train.x.path;
}

/**
 * PUT `ws` now, in order with the autosave chain, and reject with the engine
 * error (e.g. 422 `duplicate chart name`) instead of swallowing it. Used by
 * explicit user saves (chart builder) that must show why a save failed;
 * dispatch the change only once this resolves, so the autosave finds it
 * already stored. Same tombstone / epoch rules as the autosave.
 */
export function saveWorkspaceNow(ws: Workspace): Promise<WorkspaceSaveOutcome> {
  const epochAtStart = saveEpoch;
  const run = saveChain.then(() =>
    commitWorkspaceSave({
      ws,
      serialized: serializeWorkspace(ws),
      epochAtStart,
      isCurrent: (e) => e === saveEpoch,
      save: (body) => apiClient.saveWorkspace(body),
      remove: (name) => apiClient.deleteWorkspace(name),
      rethrow: true,
    }),
  );
  saveChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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
      save: (body) => apiClient.saveWorkspace(body),
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
