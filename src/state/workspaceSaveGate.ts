import { API_BASE, apiClient, serializeWorkspace } from "../api/client";
import { isStaleWriteBody, StaleWriteError, type Group, type Workspace } from "../api/types";
import { highestWriteSeq, nextWriteSeq, raiseWriteSeqAbove, WRITE_SEQ_HEADER } from "../api/writeSeq";
import { sameGroups } from "./stepGroups";
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

export interface WorkspaceSaveFailure {
  /** Engine (or network) message of the last failed autosave. */
  message: string;
  /** Workspace the failed save was for; Retry re-sends the latest commit. */
  ws: Workspace;
  /**
   * The user left this workspace (or its PUT failed after they did): the
   * edits are not on disk and cannot be retried; the banner says so until
   * dismissed.
   */
  orphaned: boolean;
}

let saveFailure: WorkspaceSaveFailure | null = null;

/**
 * Where the groups the engine answered to a PUT go when they differ from the
 * ones sent (#249). AppStore registers one that dispatches ADOPT_GROUPS.
 */
let groupsAdopter: ((sent: Workspace, groups: Group[]) => void) | null = null;

export function setGroupsAdopter(fn: typeof groupsAdopter): void {
  groupsAdopter = fn;
}

/** The `groups` of a PUT answer, null when it carries none. */
function echoedGroups(answer: unknown): Group[] | null {
  const groups = (answer as { groups?: unknown } | null)?.groups;
  return Array.isArray(groups) ? (groups as Group[]) : null;
}
const failureListeners = new Set<() => void>();

function setSaveFailure(next: WorkspaceSaveFailure | null): void {
  if (saveFailure === null && next === null) return;
  saveFailure = next;
  for (const l of failureListeners) l();
}

/** Last autosave failure, until a save succeeds (issue #218). */
export function getWorkspaceSaveFailure(): WorkspaceSaveFailure | null {
  return saveFailure;
}

export function subscribeWorkspaceSaveFailure(l: () => void): () => void {
  failureListeners.add(l);
  return () => {
    failureListeners.delete(l);
  };
}

/** Clear the failure only when it belongs to `name` (a save of another workspace says nothing about it). */
function clearSaveFailureFor(name: string): void {
  if (saveFailure && !saveFailure.orphaned && saveFailure.ws.name === name) {
    setSaveFailure(null);
  } else if (saveFailure?.orphaned && saveFailure.ws.name === name) {
    // The orphaned edits of this very name are superseded by a saved copy.
    setSaveFailure(null);
  }
}

/** Acknowledge an orphaned failure (the user was told edits were not saved). */
export function dismissWorkspaceSaveFailure(): void {
  setSaveFailure(null);
}

function failureMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e);
}

export function getWorkspaceSaveEpoch(): number {
  return saveEpoch;
}

export function getLastSavedWorkspaceJson(): string | null {
  return lastSavedWorkspaceJson;
}

/** Call after an explicit saveWorkspace so AppStore skips a redundant PUT. */
export function markWorkspaceSaved(ws: Workspace): void {
  lastSavedWorkspaceJson = serializeWorkspace(ws);
  clearSaveFailureFor(ws.name);
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
  // Another workspace's unsaved failure stays (it is told to the user, not
  // dropped); a fresh read of the same name supersedes it.
  clearSaveFailureFor(ws.name);
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

  let answer: unknown;
  try {
    try {
      answer = await save(ws);
    } catch (e) {
      // The engine holds a higher sequence than any this tab sent (clock set
      // back, another tab): this payload is not superseded by a write of ours,
      // so continue above that sequence and re-send ONCE (#263).
      if (
        e instanceof StaleWriteError &&
        e.lastSeq !== null &&
        e.lastSeq > highestWriteSeq() &&
        !(
          committedWorkspace &&
          committedWorkspace.name === ws.name &&
          serializeWorkspace(committedWorkspace) !== serialized
        )
      ) {
        raiseWriteSeqAbove(e.lastSeq);
        answer = await save(ws);
      } else {
        throw e;
      }
    }
  } catch (e) {
    // A newer write of this tab already landed (#263): this one is obsolete,
    // not failed. No banner, no retry, never recorded as saved.
    if (e instanceof StaleWriteError) {
      console.debug(`[workspace] stale save of ${ws.name} dropped: ${e.message}`);
      return "skipped";
    }
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
  // The engine normalises the groups it stores. Studio mirrors the rules, so
  // they normally come back unchanged; when they do not, adopt them and take
  // the adopted workspace as the saved one, so no PUT echoes them back (#249).
  const echoed = echoedGroups(answer);
  if (echoed && !sameGroups(echoed, ws.groups)) {
    lastSavedWorkspaceJson = serializeWorkspace({ ...ws, groups: echoed });
    groupsAdopter?.(ws, echoed);
  }
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
  lastFlushedJson = null;
  saveFailure = null;
  failureListeners.clear();
  groupsAdopter = null;
}

/** The workspace of the current React commit (null before the first one). */
export function getCommittedWorkspace(): Workspace | null {
  return committedWorkspace;
}

/** Browsers cap the bodies of in-flight `keepalive` requests at 64 KiB; stay under it. */
export const KEEPALIVE_MAX_BYTES = 60 * 1024;

/** Last payload handed to `flushWorkspaceOnPageHide`, so hidden + pagehide send it once. */
let lastFlushedJson: string | null = null;

/**
 * Page is going away (`pagehide`, tab hidden): the debounced autosave may not
 * have run, and anything async dies with the page. Send the committed,
 * unsaved workspace with a `keepalive` PUT, the same body the gate sends (#221).
 *
 * - Nothing pending (saved copy equal, not saveable, tombstoned): no request.
 * - A save already failed and awaits Retry with this very payload: no request.
 * - Body over `KEEPALIVE_MAX_BYTES`: a keepalive fetch would be rejected, so a
 *   plain fetch is attempted instead; the browser may cancel it on unload.
 * - Never throws, never awaits: unload is not delayed. A keepalive answer is
 *   unobservable on unload, so the failure state is only cleared when the page
 *   survives (tab merely hidden) and the engine answered 2xx.
 *
 * Returns true when a request was sent.
 */
export function flushWorkspaceOnPageHide(): boolean {
  try {
    const ws = committedWorkspace;
    if (!saveable(ws) || isWorkspaceSaveSuppressed(ws.name)) return false;
    const serialized = serializeWorkspace(ws);
    if (serialized === lastSavedWorkspaceJson || serialized === lastFlushedJson) {
      return false;
    }
    const f = saveFailure;
    if (
      f &&
      !f.orphaned &&
      f.ws.name === ws.name &&
      serializeWorkspace(f.ws) === serialized
    ) {
      return false;
    }
    lastFlushedJson = serialized;
    const epoch = saveEpoch;
    const savedAtSend = lastSavedWorkspaceJson;
    const keepalive = new TextEncoder().encode(serialized).length <= KEEPALIVE_MAX_BYTES;
    const sent = fetch(`${API_BASE.replace(/\/$/, "")}/workspaces/${encodeURIComponent(ws.name)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        [WRITE_SEQ_HEADER]: String(nextWriteSeq()),
      },
      body: serialized,
      keepalive,
    })
      .then(async (res) => {
        if (!res.ok && res.status === 409) {
          const body: unknown = await res.json().catch(() => null);
          if (isStaleWriteBody(res.status, body)) {
            console.debug(`[workspace] stale flush of ${ws.name} dropped`);
          }
        }
        // Only if no other save completed meanwhile: a newer answer wins.
        if (
          res.ok &&
          epoch === saveEpoch &&
          lastSavedWorkspaceJson === savedAtSend &&
          !isWorkspaceSaveSuppressed(ws.name)
        ) {
          lastSavedWorkspaceJson = serialized;
          clearSaveFailureFor(ws.name);
        } else {
          lastFlushedJson = null;
        }
      })
      .catch(() => {
        lastFlushedJson = null;
      });
    // Later autosaves, deletes and renames wait for this request (they chain
    // on / await `saveChain`), so a late flush cannot overwrite or resurrect.
    saveChain = saveChain.then(() => sent);
    return true;
  } catch {
    return false;
  }
}

/** Workspace of the current React commit (set in a layout effect, before any
 *  passive effect of the same commit runs) — MAT-175. */
let committedWorkspace: Workspace | null = null;

export function setCommittedWorkspace(ws: Workspace | null): void {
  committedWorkspace = ws;
  const f = saveFailure;
  if (!f || f.orphaned || !ws) return;
  if (ws.name !== f.ws.name) {
    // Left the workspace with unsaved edits: tell, never silently drop.
    setSaveFailure({ ...f, orphaned: true });
  } else if (serializeWorkspace(ws) === lastSavedWorkspaceJson) {
    // Edits reverted to what is on disk: nothing is unsaved any more.
    setSaveFailure(null);
  }
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
    }).then((outcome) => {
      if (outcome === "saved") clearSaveFailureFor(ws.name);
      return outcome;
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
  opts: { rethrow?: boolean } = {},
): Promise<void> {
  const serialized = serializeWorkspace(ws);
  let failed = false;
  let failure: unknown;
  const run = saveChain.then(async () => {
    if (
      committedWorkspace &&
      committedWorkspace.name === ws.name &&
      serializeWorkspace(committedWorkspace) !== serialized
    ) {
      return;
    }
    try {
      const outcome = await commitWorkspaceSave({
        ws,
        serialized,
        epochAtStart,
        isCurrent: (e) => e === saveEpoch,
        save: (body) => apiClient.saveWorkspace(body),
        remove: (name) => apiClient.deleteWorkspace(name),
        rethrow: true,
      });
      if (outcome === "saved" || serialized === lastSavedWorkspaceJson) {
        clearSaveFailureFor(ws.name);
      }
      // The user went back to the previously saved copy while this PUT was on
      // the wire: that commit saw "nothing to save" and queued nothing, so the
      // engine would keep the edit that was just undone (#244).
      if (
        outcome === "saved" &&
        committedWorkspace &&
        committedWorkspace.name === ws.name &&
        serializeWorkspace(committedWorkspace) !== serialized
      ) {
        void queueWorkspaceSave(committedWorkspace, epochAtStart);
      }
    } catch (e) {
      // Never reject the chain: later saves must still run. The failure is
      // recorded for the UI and handed to callers that asked for it (#218).
      // A PUT refused after the user edited this workspace again (or reverted
      // it to the saved copy) says nothing about what is on screen: the
      // newer commit has its own save, so recording this one would bring
      // back a notice the revert just cleared (#244).
      const superseded =
        !!committedWorkspace &&
        committedWorkspace.name === ws.name &&
        serializeWorkspace(committedWorkspace) !== serialized;
      if (!superseded) {
        setSaveFailure({
          message: failureMessage(e),
          ws,
          orphaned: !!committedWorkspace && committedWorkspace.name !== ws.name,
        });
      }
      failed = true;
      failure = e;
    }
  });
  saveChain = run;
  return opts.rethrow
    ? run.then(() => {
        if (failed) throw failure;
      })
    : run;
}

/**
 * Re-send the latest workspace after a failed autosave. Rejects (and keeps
 * the failure recorded) when the engine still refuses it.
 */
export function retryWorkspaceSave(): Promise<void> {
  const failure = saveFailure;
  // Never re-send a snapshot of a workspace the user has left.
  if (!failure || failure.orphaned) return Promise.resolve();
  const latest =
    committedWorkspace && committedWorkspace.name === failure.ws.name
      ? committedWorkspace
      : failure.ws;
  return queueWorkspaceSave(latest, saveEpoch, { rethrow: true });
}

/**
 * Resolve once the engine store holds `ws` (MAT-175). Analysis keys read the
 * named workspace from the store (`{kind:"dataset"}` sources), so every
 * consumer awaits this before `run_key`. Unlike the debounced
 * `__DTK_WORKSPACE_SAVED__` gate, it cannot observe the previous commit's
 * (already resolved) promise: child effects run before the provider's.
 * Honours the same tombstone / epoch rules as the debounced autosave.
 * Rejects with the engine error when the PUT fails, so an analysis never
 * runs against a stale on-disk workspace (#218).
 */
export function ensureWorkspaceSaved(ws: Workspace | null): Promise<void> {
  if (!saveable(ws)) return Promise.resolve();
  if (serializeWorkspace(ws) === lastSavedWorkspaceJson) {
    return saveChain;
  }
  return queueWorkspaceSave(ws, saveEpoch, { rethrow: true });
}

/**
 * Resolve once the engine store holds the on-screen edits of workspace
 * `name` (#248). Calls that read the stored file (duplicate, rename, export)
 * await it first: the autosave is debounced, so an edit made a moment ago is
 * not on disk yet. Rejects with the engine error when the PUT fails, so the
 * caller does not act on a stale file (the save-failure notice is shown).
 */
export function flushWorkspaceSave(name: string): Promise<void> {
  if (committedWorkspace && committedWorkspace.name === name) {
    return ensureWorkspaceSaved(committedWorkspace);
  }
  return saveChain;
}

/** @internal AppStore's debounced-save effect reuses the same chain/queue. */
export { queueWorkspaceSave };
