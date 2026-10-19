import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../src/api/client";
import type { Workspace } from "../src/api/types";

const ws: Workspace = {
  name: "fresh244",
  datasets: { train: { x: { kind: "csv", path: "/tmp/a.csv" } } },
  label: { mode: "order" },
  merges: [],
  variables: [],
  groups: [],
  steps: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace list after a write (#244)", () => {
  it("does not join a list request that was already on the wire", async () => {
    let release: () => void = () => undefined;
    const stale = new Promise<void>((r) => (release = r));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url.endsWith("/workspaces/summaries")) {
        const n = fetchMock.mock.calls.filter(
          ([u, i]) =>
            (i?.method ?? "GET") === "GET" &&
            String(u).endsWith("/workspaces/summaries"),
        ).length;
        // 1st call = the slow mount-time list (enumerated before the write)
        if (n === 1) await stale;
        return new Response(JSON.stringify(n === 1 ? [] : [{ name: ws.name }]));
      }
      return new Response(JSON.stringify(ws));
    });
    vi.stubGlobal("fetch", fetchMock);

    const mountList = apiClient.listWorkspaceSummaries();
    await apiClient.saveWorkspace(ws);
    const afterWrite = apiClient.listWorkspaceSummaries();
    release();

    expect(await mountList).toEqual([]);
    expect(await afterWrite).toEqual([{ name: ws.name }]);
  });
});
