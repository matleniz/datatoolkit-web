import { afterEach, describe, expect, it, vi } from "vitest";

import { postUiAck, putUiContext, uiAuthHeaders, uiEventsUrl } from "../src/api/client";

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
