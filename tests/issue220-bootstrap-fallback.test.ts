import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../src/api/client";
import { EngineError, type Workspace } from "../src/api/types";
import { loadInitialWorkspace } from "../src/bootstrap";

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

  it("reports no skipped workspace on a healthy start", async () => {
    store.set("dtk.lastWorkspace", "alpha");
    engine(["alpha", "churn"], []);
    const r = await loadInitialWorkspace();
    expect(r.workspace.name).toBe("alpha");
    expect(r.skipped).toBeNull();
  });
});
