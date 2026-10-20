import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../src/api/client";
import { EngineError, type Workspace } from "../src/api/types";
import { loadInitialWorkspace, skippedWorkspaceOf } from "../src/bootstrap";

function ws(name: string): Workspace {
  return {
    name,
    datasets: { train: { x: { kind: "csv", path: "/tmp/a.csv" } } },
    label: { mode: "order" },
    merges: [],
    variables: [],
    groups: [],
    steps: [],
  };
}

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function engine(names: string[], failing: string[]) {
  vi.spyOn(apiClient, "listWorkspaces").mockResolvedValue(names.map(ws));
  return vi.spyOn(apiClient, "getWorkspace").mockImplementation(async (n) => {
    if (failing.includes(n)) throw new EngineError("Boom", `cannot read ${n}`, 500);
    return ws(n);
  });
}

describe("remembered workspace fallback (#220)", () => {
  it("forgets a failing remembered workspace and opens churn", async () => {
    store.set("dtk.lastWorkspace", "bad");
    const get = engine(["bad", "churn", "other"], ["bad"]);
    const r = await loadInitialWorkspace();
    expect(r.workspace.name).toBe("churn");
    expect(r.skipped).toEqual({ name: "bad", reason: "cannot read bad" });
    expect(store.has("dtk.lastWorkspace")).toBe(false);
    expect(get.mock.calls.map((c) => c[0])).toEqual(["bad", "churn"]);
  });

  it("falls back to the first valid entry when churn is absent", async () => {
    store.set("dtk.lastWorkspace", "bad");
    engine(["bad", "alpha", "beta"], ["bad"]);
    const r = await loadInitialWorkspace();
    expect(r.workspace.name).toBe("alpha");
    expect(r.skipped?.name).toBe("bad");
  });

  it("throws the last error when every candidate fails, without retrying", async () => {
    store.set("dtk.lastWorkspace", "bad");
    const get = engine(["bad", "churn", "x"], ["bad", "churn", "x"]);
    await expect(loadInitialWorkspace()).rejects.toThrow("cannot read x");
    expect(get).toHaveBeenCalledTimes(3);
    expect(store.has("dtk.lastWorkspace")).toBe(false);
  });

  it("tags the thrown error with the skipped workspace, so Retry can keep naming it (#262)", async () => {
    store.set("dtk.lastWorkspace", "bad");
    engine(["bad", "churn", "x"], ["bad", "churn", "x"]);
    const err = await loadInitialWorkspace().catch((e: unknown) => e);
    expect(skippedWorkspaceOf(err)).toEqual({ name: "bad", reason: "cannot read bad" });
    // The retry has no remembered name any more: nothing skipped, still failing.
    const again = await loadInitialWorkspace().catch((e: unknown) => e);
    expect(skippedWorkspaceOf(again)).toBeNull();
  });

  it("tags the error of a corrupt remembered workspace when the fallback fails too (#262)", async () => {
    store.set("dtk.lastWorkspace", "bad");
    vi.spyOn(apiClient, "listWorkspaces").mockResolvedValue([
      { name: "bad", corrupt: true, error: "invalid JSON" } as never,
      ws("churn"),
    ]);
    vi.spyOn(apiClient, "getWorkspace").mockRejectedValue(new EngineError("Boom", "nope", 500));
    const err = await loadInitialWorkspace().catch((e: unknown) => e);
    expect(skippedWorkspaceOf(err)).toMatchObject({ name: "bad", corrupt: true });
  });

  it("reports no skipped workspace on a healthy start", async () => {
    store.set("dtk.lastWorkspace", "alpha");
    engine(["alpha", "churn"], []);
    const r = await loadInitialWorkspace();
    expect(r.workspace.name).toBe("alpha");
    expect(r.skipped).toBeNull();
  });
});

describe("corrupt remembered workspace (#236)", () => {
  const bad = { name: "bad", corrupt: true as const, error: "WorkspaceCorruptError" };

  it("skips a corrupt remembered workspace without a GET and says why", async () => {
    store.set("dtk.lastWorkspace", "bad");
    vi.spyOn(apiClient, "listWorkspaces").mockResolvedValue([bad, ws("churn")]);
    const get = vi.spyOn(apiClient, "getWorkspace").mockImplementation(async (n) => ws(n));
    const r = await loadInitialWorkspace();
    expect(r.workspace.name).toBe("churn");
    expect(r.skipped).toEqual({ name: "bad", reason: "WorkspaceCorruptError", corrupt: true });
    expect(store.has("dtk.lastWorkspace")).toBe(false);
    expect(get.mock.calls.map((c) => c[0])).toEqual(["churn"]);
  });

  it("needs no startup notice when the corrupt entries are not remembered", async () => {
    store.set("dtk.lastWorkspace", "churn");
    vi.spyOn(apiClient, "listWorkspaces").mockResolvedValue([bad, ws("churn")]);
    vi.spyOn(apiClient, "getWorkspace").mockImplementation(async (n) => ws(n));
    const r = await loadInitialWorkspace();
    expect(r.skipped).toBeNull();
  });

  it("reports the corrupt remembered workspace to a concurrent second run (StrictMode)", async () => {
    store.set("dtk.lastWorkspace", "bad");
    vi.spyOn(apiClient, "listWorkspaces").mockResolvedValue([bad, ws("churn")]);
    vi.spyOn(apiClient, "getWorkspace").mockImplementation(async (n) => ws(n));
    const [a, b] = await Promise.all([loadInitialWorkspace(), loadInitialWorkspace()]);
    expect(a.skipped?.name).toBe("bad");
    expect(b.skipped?.name).toBe("bad");
  });
});
