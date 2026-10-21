import { describe, expect, it } from "vitest";
import type { Step } from "../src/api/types";
import { applyStepOps } from "../src/state/stepOps";
import { parseStepsFile, serializeStepsFile, stepsToOps } from "../src/state/stepsFile";

const steps: Step[] = [
  { id: "s1", op: "impute", target: "both", params: { columns: ["age"], strategy: "median" }, note: "why" },
  { id: "s2", op: "scale", target: "train", params: { columns: ["age"] }, align: true },
];

describe("stepsFile", () => {
  it("round-trips without ids or the align flag", () => {
    const text = serializeStepsFile(steps);
    expect(JSON.parse(text).steps[0]).not.toHaveProperty("id");
    const out = parseStepsFile(text);
    expect(out).toEqual({
      steps: [
        { op: "impute", target: "both", params: { columns: ["age"], strategy: "median" }, note: "why" },
        { op: "scale", target: "train", params: { columns: ["age"] } },
      ],
    });
  });

  it("appends the imported steps with new ids in one batch", () => {
    const parsed = parseStepsFile(serializeStepsFile(steps));
    if ("error" in parsed) throw new Error(parsed.error);
    const target = { steps: [{ id: "x1", op: "drop_columns", target: "both", params: {} } as Step], groups: [] };
    const out = applyStepOps(target, stepsToOps(parsed.steps));
    if ("error" in out) throw new Error(out.error);
    expect(out.steps.map((s) => s.op)).toEqual(["drop_columns", "impute", "scale"]);
    expect(new Set(out.steps.map((s) => s.id)).size).toBe(3);
  });

  const bad = (v: unknown) => parseStepsFile(typeof v === "string" ? v : JSON.stringify(v));
  const file = (step: unknown) => ({ format: "dtk-steps", version: 1, steps: [step] });
  it.each([
    ["invalid JSON", "{nope", /valid JSON/],
    ["wrong format", { format: "x", version: 1, steps: [] }, /Not a steps file/],
    ["wrong version", { format: "dtk-steps", version: 2, steps: [] }, /version/],
    ["no steps", { format: "dtk-steps", version: 1, steps: [] }, /no steps/],
    ["unknown op", file({ op: "rm_rf", target: "both", params: {} }), /unknown op/],
    ["bad target", file({ op: "impute", target: "x", params: {} }), /target/],
    ["params not object", file({ op: "impute", target: "both", params: [] }), /params/],
    ["note not string", file({ op: "impute", target: "both", params: {}, note: 3 }), /note/],
    ["step not object", file(7), /not an object/],
  ])("rejects %s", (_n, input, re) => {
    const out = bad(input);
    expect("error" in out && out.error).toMatch(re);
  });

  it("rejects an oversized file", () => {
    expect("error" in parseStepsFile(" ".repeat(1_000_001))).toBe(true);
  });
});
