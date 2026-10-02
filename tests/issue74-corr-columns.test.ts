import { describe, expect, it } from "vitest";

import type { ColumnProfile, Result } from "../src/api/types";
import {
  chartColumnsOf,
  corrRanColumns,
  toolPlan,
  type PlanCtx,
} from "../src/bench/dock/dockToolPlan";

const NUMERIC = ["sexM", "age_at_diagnosis", "age", "ledd", "t_on", "t_off", "on", "off"];

function ctx(selCols: string[], scopeAll = false): PlanCtx {
  const profiles = [...NUMERIC, "target"].map(
    (name) => ({ name, kind: "number" }) as unknown as ColumnProfile,
  );
  return {
    id: "corr",
    key: "correlations",
    role: "train",
    selCols,
    scopeAll,
    target: "target",
    focus: null,
    splitBy: null,
    profiles,
  };
}

describe("correlation matrix columns (#74)", () => {
  const plan = toolPlan("corr");

  it("sends no columns without a selection, so no numeric column is dropped", () => {
    expect(plan.columns?.(ctx([]))).toBeNull();
    expect(plan.guard?.(ctx([]))).toBeNull();
  });

  it("sends the whole selection (no cap) when two or more numeric are picked", () => {
    expect(plan.columns?.(ctx(["off", "age", "on"]))).toEqual(["off", "age", "on"]);
    const all = plan.columns?.(ctx(NUMERIC));
    expect(all).toEqual(NUMERIC);
  });

  it("labels the bound with what the engine ran on", () => {
    const ran = NUMERIC;
    expect(plan.bound(ctx([]), { hasCols: true, sent: undefined, ran })).toBe(
      "key correlations · 8 columns",
    );
  });

  it("reads the ran columns off the matrix table; Open in Chart keeps them", () => {
    const result: Result = {
      metrics: {},
      figures: [],
      text: "",
      tables: [
        { title: "matrix", records: NUMERIC.map((column) => ({ column })) },
      ],
    };
    const ran = corrRanColumns(result, null);
    expect(ran).toContain("off");
    expect(ran).toHaveLength(8);
    expect(chartColumnsOf("corr", "{}", true, [], ran).names).toEqual(NUMERIC);
  });
});
