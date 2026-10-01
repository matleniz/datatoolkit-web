import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient, serializeWorkspace } from "../src/api/client";
import { EngineError, type Workspace } from "../src/api/types";
import { hydrateWorkspaceCharts } from "../src/state/chartStorage";
import {
  commitWorkspaceSave,
  getLastSavedWorkspaceJson,
  getWorkspaceSaveEpoch,
  resetWorkspaceSaveGateForTests,
  saveWorkspaceNow,
} from "../src/state/workspaceSaveGate";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

function ws(charts?: Workspace["charts"]): Workspace {
  return {
    name: "titanic",
    datasets: { train: { x: { kind: "csv", path: "/tmp/train.csv" } } },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
    ...(charts ? { charts } : {}),
  };
}

const ageFare = { name: "Age vs Fare", params: { chart: "scatter", x: "Age" } };
const LEGACY_KEY = "dtk.charts.titanic";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetWorkspaceSaveGateForTests();
});

describe("Workspace.charts persistence (datatoolkit-issues#11)", () => {
  it("sends charts on PUT, never on frame / analysis calls", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse(200, {});
      }),
    );
    const w = ws([ageFare]);
    await apiClient.saveWorkspace(w);
    await apiClient.columnProfiles(w, "train");

    expect(bodies[0]?.charts).toEqual([ageFare]);
    expect(bodies[1]?.workspace).not.toHaveProperty("charts");
    expect(serializeWorkspace(w)).not.toBe(serializeWorkspace(ws()));
    // No charts on the front object still PUTs an explicit empty list.
    expect(JSON.parse(serializeWorkspace(ws())).charts).toEqual([]);
  });

  it("engine charts win; legacy browser charts migrate when the engine has none", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([ageFare, { bad: 1 }]));
    const other = { name: "kept", params: {} };

    expect(hydrateWorkspaceCharts(ws([other])).charts).toEqual([other]);
    expect(hydrateWorkspaceCharts(ws()).charts).toEqual([ageFare]);
    expect(hydrateWorkspaceCharts(ws([])).charts).toEqual([ageFare]);
  });

  it("drops the legacy copy once a save of that workspace succeeds", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([ageFare]));
    const body = ws([ageFare]);
    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized: serializeWorkspace(body),
      epochAtStart: getWorkspaceSaveEpoch(),
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save: async () => body,
      remove: async () => undefined,
    });
    expect(outcome).toBe("saved");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("keeps the legacy copy when the save fails", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([ageFare]));
    const body = ws([ageFare]);
    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized: serializeWorkspace(body),
      epochAtStart: getWorkspaceSaveEpoch(),
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save: async () => {
        throw new EngineError("HttpError", "HTTP 500", 500);
      },
      remove: async () => undefined,
    });
    expect(outcome).toBe("skipped");
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it("saveWorkspaceNow rejects with the engine's duplicate-name 422", async () => {
    const message = "charts: duplicate chart name 'Age vs Fare'";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(422, { type: "KeyParamsError", message })),
    );
    const dup = ws([ageFare, { ...ageFare, params: {} }]);

    await expect(saveWorkspaceNow(dup)).rejects.toMatchObject({
      type: "KeyParamsError",
      status: 422,
      message,
    });
    expect(getLastSavedWorkspaceJson()).toBeNull();

    // The chain survives the rejection: the next save still runs.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, {})));
    await expect(saveWorkspaceNow(ws([ageFare]))).resolves.toBe("saved");
    expect(getLastSavedWorkspaceJson()).toBe(serializeWorkspace(ws([ageFare])));
  });
});
