import { describe, expect, it } from "vitest";

import type { ColumnProfile } from "../src/api/types";
import { missPct } from "../src/bench/alerts";

// Parkinson time_since_intake_off: 55 603 rows, 43 828 missing. The engine's
// `count` is the non-null count (11 775), so missing > count.
const profile = { count: 11_775, missing: 43_828 } as ColumnProfile;

describe("missPct (#72)", () => {
  it("divides by count + missing, not by the non-null count", () => {
    expect(missPct(profile)).toBe(79);
  });

  it("handles none / all missing / no profile", () => {
    expect(missPct({ count: 10, missing: 0 } as ColumnProfile)).toBe(0);
    expect(missPct({ count: 0, missing: 5 } as ColumnProfile)).toBe(100);
    expect(missPct({ count: 0, missing: 0 } as ColumnProfile)).toBe(0);
    expect(missPct(undefined)).toBe(0);
  });
});
