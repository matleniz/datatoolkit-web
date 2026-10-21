import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ColumnProfile } from "../src/api/types";
import { qualityShares, qualityTip } from "../src/bench/alerts";
import { ColumnHeader } from "../src/bench/grid/Grid";

const p = (o: Partial<ColumnProfile>) =>
  ({ count: 0, missing: 0, sentinel_candidates: [], ...o }) as ColumnProfile;

describe("qualityShares (#310)", () => {
  it("splits valid / mismatched / missing and sums to 100", () => {
    const q = qualityShares(
      p({
        count: 80,
        missing: 20,
        sentinel_candidates: [
          { value: -999, count: 10 },
          { value: "N/A", count: 5 },
        ],
      }),
    );
    expect(q).toMatchObject({
      rows: 100,
      valid: 65,
      mismatched: 15,
      missing: 20,
      validPct: 65,
      mismatchedPct: 15,
      missingPct: 20,
    });
  });

  it("clamps sentinels to the non-null count and keeps the sum at 100", () => {
    const q = qualityShares(
      p({
        count: 3,
        missing: 7,
        sentinel_candidates: [{ value: 0, count: 99 }],
      }),
    );
    expect(q.mismatched).toBe(3);
    expect(q.validPct + q.mismatchedPct + q.missingPct).toBe(100);
  });

  it("handles clean, empty and absent profiles", () => {
    expect(qualityShares(p({ count: 10 })).validPct).toBe(100);
    expect(qualityShares(p({})).validPct).toBe(0);
    expect(qualityShares(undefined).rows).toBe(0);
  });

  it("tooltip says mismatched is approximate", () => {
    expect(qualityTip(qualityShares(p({ count: 1 })))).toMatch(/approximate/);
  });
});

describe("ColumnHeader quality bar (#310)", () => {
  it("renders three segments and the approximate tooltip on .miss-bar", () => {
    const profile = p({
      name: "age",
      kind: "number",
      count: 80,
      missing: 20,
      sentinel_candidates: [{ value: -999, count: 10 }],
    });
    const html = renderToStaticMarkup(
      createElement(ColumnHeader, {
        c: { name: "age", kind: "number", status: "kept" },
        sel: false,
        isTarget: false,
        touched: false,
        profile,
        note: undefined,
        dispatch: () => {},
        reorder: {
          enabled: false,
          hint: null,
          start() {},
          over() {},
          end() {},
          drop() {},
        },
      } as never),
    );
    expect(html).toContain('class="q-valid" style="width:70%"');
    expect(html).toContain('class="q-mismatched" style="width:10%"');
    expect(html).toContain('class="q-missing" style="width:20%"');
    expect(html).toMatch(/class="miss-bar" title="Valid 70%[^"]*approximate/);
  });
});
