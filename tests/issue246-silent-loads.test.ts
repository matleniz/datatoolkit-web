import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../src/api/client";
import { cancelInFlight, inFlightCount } from "../src/api/inflight";
import { EngineError, type Workspace } from "../src/api/types";
import { enrichFileItem } from "../src/screens/sources/sourcesScreenLogic";

const ws: Workspace = {
  name: "w246",
  datasets: { train: { x: { kind: "csv", path: "/tmp/a.csv" } } },
  label: { mode: "order" },
  merges: [],
  variables: [],
  groups: [],
  steps: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function failure(p: Promise<unknown>): Promise<EngineError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    return e as EngineError;
  }
  throw new Error("expected a rejection");
}

describe("silent load paths (#246)", () => {
  it("a 200 with a non-JSON body is an error, not data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", async () => new Response("<html>proxy</html>", { status: 200 }));
    const e = await failure(apiClient.previewWorkspace(ws, "train"));
    expect(e.type).toBe("ParseError");
    expect(e.message).toContain("not JSON");
  });

  it("a 5xx with an HTML body reports the status, not the page as a ParseError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      async () => new Response("<h1>Bad Gateway</h1>", { status: 502, statusText: "Bad Gateway" }),
    );
    const e = await failure(apiClient.sourceColumns(ws.datasets.train.x));
    expect(e.type).toBe("HttpError");
    expect(e.status).toBe(502);
    expect(e.message).toContain("HTTP 502 Bad Gateway");
  });

  it("a refused connection explains that the engine is unreachable and logs the detail", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const e = await failure(apiClient.previewWorkspace(ws, "train"));
    expect(e.type).toBe("NetworkError");
    expect(e.message).toContain("Cannot reach the engine");
    expect(log).toHaveBeenCalled();
  });

  it("a failed schema fetch is not cached for the session", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n += 1;
      return n === 1
        ? new Response(JSON.stringify({ type: "Boom", message: "x" }), { status: 500 })
        : new Response(JSON.stringify({ properties: {} }), { status: 200 });
    });
    await failure(apiClient.transformSchema("drop_columns246"));
    await expect(apiClient.transformSchema("drop_columns246")).resolves.toEqual({
      properties: {},
    });
  });

  it("a failed transform catalogue is retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n += 1;
      return n === 1
        ? new Response("", { status: 500 })
        : new Response(JSON.stringify([]), { status: 200 });
    });
    await failure(apiClient.listTransforms());
    await expect(apiClient.listTransforms()).resolves.toEqual([]);
  });

  it("an unreadable stored file keeps the engine reason on the item", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ type: "SourceError", message: "bad csv" }), { status: 422 }),
    );
    const item = await enrichFileItem({
      id: "f1",
      name: "t.csv",
      path: "/tmp/t.csv",
      cols: [],
      detected: "",
      spec: { kind: "csv", path: "/tmp/t.csv" },
    } as never);
    expect(item.parseError).toContain("bad csv");
  });
});

describe("busy tracking and cancel (#247)", () => {
  it("counts a source request while it is on the wire and cancel rejects it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      (_url: string, init?: RequestInit) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener("abort", () =>
            rej(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const p = apiClient.previewWorkspace(ws, "train");
    const settled = failure(p);
    expect(inFlightCount("source")).toBe(1);
    expect(inFlightCount("frame")).toBe(0);
    cancelInFlight("source");
    const e = await settled;
    expect(e.type).toBe("Cancelled");
    expect(inFlightCount("source")).toBe(0);
  });
});
