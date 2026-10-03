import { describe, expect, it } from "vitest";

import {
  compactValue,
  hiddenLines,
  LINES_MAX,
  summaryLines,
  truncate,
  VALUE_MAX,
} from "../src/bench/agent/panel/toolSummary";

describe("agent tool summary (#113)", () => {
  it("truncates with an ellipsis, short text untouched", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdef", 5)).toBe("abcd…");
  });

  it("compacts values: strings as is, the rest as JSON", () => {
    expect(compactValue("x")).toBe("x");
    expect(compactValue({ a: [1, 2] })).toBe('{"a":[1,2]}');
    expect(compactValue(undefined)).toBe("undefined");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(typeof compactValue(cyclic)).toBe("string");
  });

  it("builds key / value lines and flags the long ones", () => {
    const long = "x".repeat(VALUE_MAX + 10);
    const lines = summaryLines({ tool: "dist", note: long });
    expect(lines[0]).toEqual({ key: "tool", short: "dist", full: "dist", truncated: false });
    expect(lines[1]?.truncated).toBe(true);
    expect(lines[1]?.short).toHaveLength(VALUE_MAX);
    expect(lines[1]?.full).toBe(long);
  });

  it("counts the input lines hidden behind the cut", () => {
    const many = Object.fromEntries(Array.from({ length: LINES_MAX + 3 }, (_, i) => [`k${i}`, i]));
    expect(hiddenLines(many)).toBe(3);
    expect(hiddenLines({ a: 1 })).toBe(0);
  });
});
