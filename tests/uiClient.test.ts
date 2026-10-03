import { afterEach, describe, expect, it, vi } from "vitest";

import {
  postUiAck,
  putUiContext,
  uiAuthHeaders,
  uiError,
  uiEventsUrl,
  UiHttpError,
  uiSession,
  uiUrl,
} from "../src/api/client";
import { getTerminalPacks } from "../src/bench/agent/terminal/terminalOptions";

afterEach(() => vi.unstubAllGlobals());

describe("agent bridge client", () => {
  it("puts the token and session in the EventSource URL", () => {
    expect(uiEventsUrl("s 1", "t&k", "/api")).toBe("/api/ui/events?session=s+1&token=t%26k");
    expect(uiEventsUrl("s", "t", "http://x/api/")).toBe("http://x/api/ui/events?session=s&token=t");
  });

  it("sends the token as a bearer header", () => {
    expect(uiAuthHeaders("abc")).toEqual({ Authorization: "Bearer abc" });
  });

  it("PUTs the context with the bearer token, never in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    await putUiContext("tok", { session: "s" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/ui/context");
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ session: "s" });
  });

  it("ignores a 404 ack (command already timed out) but not other errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(postUiAck("t", { id: "c1", ok: true })).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(postUiAck("t", { id: "c1", ok: true })).rejects.toThrow("401");
  });
});

describe("shared /ui plumbing (#130)", () => {
  it("builds every /ui URL from the one API base", () => {
    expect(uiUrl("/agent/options")).toBe("/api/ui/agent/options");
    expect(uiUrl("/agent", "http://x/api/")).toBe("http://x/api/ui/agent");
  });

  it("keeps one per-tab session id", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    });
    const id = uiSession();
    expect(uiSession()).toBe(id);
    expect(store.get("dtk-ui-session")).toBe(id);
  });

  it("reads the engine's {type, message} error body, falls back to the status", async () => {
    const json = (body: unknown) => async () => body;
    const err = await uiError({ status: 409, json: json({ type: "AgentBusy", message: "a turn runs" }) } as unknown as Response, "POST /ui/agent/send");
    expect(err).toBeInstanceOf(UiHttpError);
    expect(err).toMatchObject({ status: 409, kind: "AgentBusy", message: "a turn runs" });
    const bare = await uiError({ status: 500, json: () => Promise.reject(new Error("no body")) } as unknown as Response, "GET /ui/x");
    expect(bare).toMatchObject({ status: 500, kind: undefined, message: "GET /ui/x: HTTP 500" });
  });

  it("terminal packs: an engine error keeps its message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ type: "NoAgent", message: "extra agent missing" }) }));
    await expect(getTerminalPacks("t")).rejects.toThrow("extra agent missing");
  });
});
