import { describe, expect, it } from "vitest";

import {
  attachmentReducer,
  canSend,
  formatSize,
  isUploading,
  NO_ATTACHMENTS,
  readyAttachments,
} from "./attachmentState";
import { toWire } from "./attachmentContract";

const add = (id: string, name = `${id}.csv`) => ({ type: "add", id, name, size: 10 }) as const;

describe("attachmentReducer", () => {
  it("adds as uploading, then ready with the engine id", () => {
    let s = attachmentReducer(NO_ATTACHMENTS, add("a"));
    expect(s[0]).toMatchObject({ status: "uploading", name: "a.csv" });
    s = attachmentReducer(s, { type: "ready", id: "a", serverId: "a1", kind: "table" });
    expect(s[0]).toMatchObject({ status: "ready", serverId: "a1", kind: "table" });
  });

  it("marks a failure and removes chips", () => {
    let s = attachmentReducer(attachmentReducer(NO_ATTACHMENTS, add("a")), add("b"));
    s = attachmentReducer(s, { type: "failed", id: "a", error: "boom" });
    expect(s[0]).toMatchObject({ status: "failed", error: "boom" });
    s = attachmentReducer(s, { type: "remove", id: "a" });
    expect(s.map((a) => a.id)).toEqual(["b"]);
    expect(attachmentReducer(s, { type: "reset" })).toEqual([]);
  });
});

describe("send gating", () => {
  it("blocks while an upload is in flight, ignores failed chips", () => {
    let s = attachmentReducer(NO_ATTACHMENTS, add("a"));
    expect(isUploading(s)).toBe(true);
    expect(canSend("hi", s)).toBe(false);
    s = attachmentReducer(s, { type: "failed", id: "a", error: "x" });
    expect(canSend("hi", s)).toBe(true);
    expect(canSend("  ", s)).toBe(false);
    expect(readyAttachments(s)).toEqual([]);
  });
});

describe("toWire", () => {
  it("lists ready attachments only, undefined when none", () => {
    let s = attachmentReducer(NO_ATTACHMENTS, add("a"));
    expect(toWire(s)).toBeUndefined();
    s = attachmentReducer(s, { type: "ready", id: "a", serverId: "a1", kind: "table" });
    s = attachmentReducer(s, add("b"));
    expect(toWire(s)).toEqual(["a1"]);
  });
});

describe("formatSize", () => {
  it("formats bytes", () => {
    expect(formatSize(12)).toBe("12 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(-1)).toBe("");
  });
});
