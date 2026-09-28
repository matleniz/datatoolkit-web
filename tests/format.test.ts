import { describe, expect, it } from "vitest";
import {
  cellDisplay,
  EMPTY_DATA_ROWS_MSG,
  fmtPreview,
  nameDisplay,
  TEXT_PREVIEW_CHARS,
  truncateText,
} from "../src/bench/format";

describe("nameDisplay / cellDisplay quoting", () => {
  it("quotes names with leading or trailing spaces like cells", () => {
    expect(nameDisplay("city_Lille")).toBe("city_Lille");
    expect(nameDisplay("city_Lille ")).toBe("“city_Lille ”");
    expect(nameDisplay(" Lille")).toBe("“ Lille”");
    expect(cellDisplay("Lille ")).toBe("“Lille ”");
    expect(cellDisplay("Lille")).toBe("Lille");
  });
});

describe("long string truncation (MAT-154 item 3)", () => {
  it("truncateText marks strings longer than the preview limit", () => {
    const long = "A".repeat(TEXT_PREVIEW_CHARS + 10);
    const { text, truncated } = truncateText(long);
    expect(truncated).toBe(true);
    expect(text).toHaveLength(TEXT_PREVIEW_CHARS);
    expect(text).not.toContain("B");
  });

  it("cellDisplay and fmtPreview never emit the full 50k string", () => {
    const long = "Z".repeat(50_000);
    const shown = cellDisplay(long);
    expect(shown.length).toBeLessThan(TEXT_PREVIEW_CHARS + 5);
    expect(shown.endsWith("…")).toBe(true);
    expect(fmtPreview(long).length).toBeLessThan(TEXT_PREVIEW_CHARS + 5);
  });
});

describe("empty-state copy (MAT-154 item 2)", () => {
  it("exports a stable empty-rows message", () => {
    expect(EMPTY_DATA_ROWS_MSG).toMatch(/0 data rows/);
  });
});
