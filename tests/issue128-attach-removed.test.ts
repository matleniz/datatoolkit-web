import { describe, expect, it, vi } from "vitest";

import { attachFile, type AttachDeps } from "../src/bench/agent/attachments/attachFlow";

/** datatoolkit-issues#128: a chip removed while uploading never stays attached. */

const file = new File(["a,b\n1,2\n"], "x.csv");

function deps(onRegister?: () => void): AttachDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    upload: vi.fn(async () => {
      calls.push("upload");
      return { path: "/uploads/x.csv" };
    }),
    register: vi.fn(async () => {
      calls.push("register");
      onRegister?.();
      return { id: "a1", kind: "table" };
    }),
    detach: vi.fn(async (id: string) => {
      calls.push(`detach ${id}`);
    }),
  };
}

describe("attachFile", () => {
  it("registers and reports ready when the chip is kept", async () => {
    const d = deps();
    const out = await attachFile(file, () => false, d);
    expect(out).toEqual({ kind: "ready", attachment: { id: "a1", kind: "table" } });
    expect(d.calls).toEqual(["upload", "register"]);
  });

  it("removed before the upload ends: never registered", async () => {
    const d = deps();
    const out = await attachFile(file, () => true, d);
    expect(out).toEqual({ kind: "dropped" });
    expect(d.calls).toEqual(["upload"]);
  });

  it("removed while registering: the registered id is detached, no ready chip", async () => {
    let removed = false;
    const d = deps(() => {
      removed = true;
    });
    const out = await attachFile(file, () => removed, d);
    expect(out).toEqual({ kind: "dropped" });
    expect(d.calls).toEqual(["upload", "register", "detach a1"]);
  });

  it("propagates an upload failure (the chip shows it)", async () => {
    const d = deps();
    d.upload = vi.fn(async () => {
      throw new Error("disk full");
    });
    await expect(attachFile(file, () => false, d)).rejects.toThrow("disk full");
    expect(d.register).not.toHaveBeenCalled();
  });
});
