import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../src/api/client";
import {
  EngineError,
  isUploadTooLarge,
  uploadErrorText,
} from "../src/api/types";
import { attachmentReducer, NO_ATTACHMENTS } from "../src/bench/agent/attachments/attachmentState";

const CAP_MESSAGE =
  "upload is over the 1 MiB limit; raise it with the DTK_MAX_UPLOAD_MB variable";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("413 UploadTooLargeError (datatoolkit-issues#299)", () => {
  it("the client rejects with the engine type, message and status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ type: "UploadTooLargeError", message: CAP_MESSAGE, details: null }),
          { status: 413, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const err = await apiClient.upload("big.csv", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ type: "UploadTooLargeError", message: CAP_MESSAGE, status: 413 });
    expect(isUploadTooLarge(err)).toBe(true);
  });

  it("names the file with the engine message; other errors keep their text", () => {
    const tooLarge = new EngineError("UploadTooLargeError", CAP_MESSAGE, 413);
    expect(uploadErrorText("big.csv", tooLarge)).toBe(`Cannot add “big.csv”: ${CAP_MESSAGE}`);
    const other = new EngineError("UploadStoreError", "disk full", 500);
    expect(isUploadTooLarge(other)).toBe(false);
    expect(uploadErrorText("big.csv", other)).toBe("disk full");
    expect(isUploadTooLarge({ type: "UploadTooLargeError", message: CAP_MESSAGE })).toBe(false);
  });

  it("a refused attachment chip is marked too large", () => {
    let s = attachmentReducer(NO_ATTACHMENTS, { type: "add", id: "a", name: "big.csv", size: 9 });
    s = attachmentReducer(s, { type: "failed", id: "a", error: CAP_MESSAGE, tooLarge: true });
    expect(s[0]).toMatchObject({ status: "failed", error: CAP_MESSAGE, tooLarge: true });
  });
});
