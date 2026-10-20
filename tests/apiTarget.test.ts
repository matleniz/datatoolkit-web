import { describe, expect, it } from "vitest";

import { resolveApiTarget } from "../scripts/apiTarget";

describe("resolveApiTarget", () => {
  it("defaults to the engine's port 8765", () => {
    expect(resolveApiTarget({})).toBe("http://127.0.0.1:8765");
    expect(resolveApiTarget({ DTK_API_PORT: "" })).toBe("http://127.0.0.1:8765");
  });

  it("uses DTK_API_PORT", () => {
    expect(resolveApiTarget({ DTK_API_PORT: "9000" })).toBe("http://127.0.0.1:9000");
    expect(resolveApiTarget({ DTK_API_PORT: " 9001 " })).toBe("http://127.0.0.1:9001");
  });

  it("falls back to the default on an invalid value", () => {
    for (const bad of ["abc", "0", "70000", "-1", "80.5"]) {
      expect(resolveApiTarget({ DTK_API_PORT: bad })).toBe("http://127.0.0.1:8765");
    }
  });
});
