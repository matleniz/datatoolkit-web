import { afterEach, describe, expect, it, vi } from "vitest";

import { serializeWorkspace } from "../src/api/client";
import type { Workspace } from "../src/api/types";
import {
  abandonPendingWorkspaceSave,
  allowWorkspaceSave,
  commitWorkspaceSave,
  getLastSavedWorkspaceJson,
  getWorkspaceSaveEpoch,
  isWorkspaceSaveSuppressed,
  markWorkspaceSaved,
  resetWorkspaceSaveGateForTests,
} from "../src/state/workspaceSaveGate";

function ws(name: string, path = "/tmp/train.csv"): Workspace {
  return {
    name,
    datasets: {
      train: { x: { kind: "csv", path } },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

afterEach(() => {
  resetWorkspaceSaveGateForTests();
});

describe("workspaceSaveGate (MAT-217)", () => {
  it("skips PUT when the workspace name was abandoned (tombstone)", async () => {
    const body = ws("mat171_a");
    const serialized = serializeWorkspace(body);
    const epoch = getWorkspaceSaveEpoch();
    const save = vi.fn(async () => body);
    const remove = vi.fn(async () => undefined);

    abandonPendingWorkspaceSave(["mat171_a"]);

    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized,
      epochAtStart: epoch,
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove,
    });

    expect(outcome).toBe("skipped");
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(isWorkspaceSaveSuppressed("mat171_a")).toBe(true);
  });

  it("skips PUT when save epoch was bumped (pending debounce cancelled)", async () => {
    const body = ws("mat171_a");
    const serialized = serializeWorkspace(body);
    const epoch = getWorkspaceSaveEpoch();
    const save = vi.fn(async () => body);

    abandonPendingWorkspaceSave();

    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized,
      epochAtStart: epoch,
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove: async () => undefined,
    });

    expect(outcome).toBe("skipped");
    expect(save).not.toHaveBeenCalled();
  });

  it("aborts an in-flight save when abandon is called", async () => {
    const body = ws("mat171_a");
    const serialized = serializeWorkspace(body);
    const epoch = getWorkspaceSaveEpoch();
    let release!: () => void;
    const saveStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = vi.fn(async (_w: Workspace, signal: AbortSignal) => {
      release();
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
      return body;
    });
    const remove = vi.fn(async () => undefined);

    const pending = commitWorkspaceSave({
      ws: body,
      serialized,
      epochAtStart: epoch,
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove,
    });

    await saveStarted;
    abandonPendingWorkspaceSave(["mat171_a"]);
    // Tombstoned + aborted → best-effort undo delete (idempotent if never PUT).
    await expect(pending).resolves.toBe("undone");
    expect(remove).toHaveBeenCalledWith("mat171_a");
  });

  it("undoes a PUT that lands after the name was tombstoned (delete wins)", async () => {
    const body = ws("mat171_a");
    const serialized = serializeWorkspace(body);
    const epoch = getWorkspaceSaveEpoch();
    const disk = new Map<string, Workspace>();

    let afterStarted!: () => void;
    const started = new Promise<void>((r) => {
      afterStarted = r;
    });
    let releaseSave!: () => void;
    const hold = new Promise<void>((r) => {
      releaseSave = r;
    });

    // Models a request already on the wire: ignore AbortSignal and still write.
    const slowSave = vi.fn(async (w: Workspace, signal: AbortSignal) => {
      afterStarted();
      await hold;
      void signal;
      disk.set(w.name, structuredClone(w));
      return w;
    });
    const remove = vi.fn(async (name: string) => {
      disk.delete(name);
    });

    const pending = commitWorkspaceSave({
      ws: body,
      serialized,
      epochAtStart: epoch,
      isCurrent: () => true,
      save: slowSave,
      remove,
    });

    await started;
    abandonPendingWorkspaceSave(["mat171_a"]);
    releaseSave();

    await expect(pending).resolves.toBe("undone");
    expect(disk.has("mat171_a")).toBe(false);
    expect(remove).toHaveBeenCalledWith("mat171_a");
  });

  it("saves when current and not suppressed", async () => {
    const body = ws("mat171_a");
    const serialized = serializeWorkspace(body);
    const epoch = getWorkspaceSaveEpoch();
    const save = vi.fn(async () => body);
    const remove = vi.fn(async () => undefined);

    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized,
      epochAtStart: epoch,
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove,
    });

    expect(outcome).toBe("saved");
    expect(save).toHaveBeenCalledOnce();
    expect(getLastSavedWorkspaceJson()).toBe(serialized);
    expect(remove).not.toHaveBeenCalled();
  });

  it("allowWorkspaceSave clears a tombstone so recreate can persist", async () => {
    abandonPendingWorkspaceSave(["ghost"]);
    expect(isWorkspaceSaveSuppressed("ghost")).toBe(true);
    allowWorkspaceSave("ghost");
    expect(isWorkspaceSaveSuppressed("ghost")).toBe(false);

    const body = ws("ghost");
    const serialized = serializeWorkspace(body);
    const epoch = getWorkspaceSaveEpoch();
    const save = vi.fn(async () => body);

    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized,
      epochAtStart: epoch,
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove: async () => undefined,
    });
    expect(outcome).toBe("saved");
  });

  it("markWorkspaceSaved clears tombstone and skips identical PUT", async () => {
    const body = ws("mat171_a");
    abandonPendingWorkspaceSave(["mat171_a"]);
    markWorkspaceSaved(body);
    expect(isWorkspaceSaveSuppressed("mat171_a")).toBe(false);
    expect(getLastSavedWorkspaceJson()).toBe(serializeWorkspace(body));

    const save = vi.fn(async () => body);
    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized: serializeWorkspace(body),
      epochAtStart: getWorkspaceSaveEpoch(),
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove: async () => undefined,
    });
    expect(outcome).toBe("skipped");
    expect(save).not.toHaveBeenCalled();
  });
});
