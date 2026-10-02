import { describe, expect, it } from "vitest";
import { dockFigureLayout } from "../src/bench/dock/figureDisplay";
import { formulaPyExamples } from "../src/bench/editor/formulaFuncs";
import { imputeOfferedColumns } from "../src/bench/schemaFields";
import { fmtCount } from "../src/bench/format";
import { formatShape } from "../src/screens/sources/workspaceManagerLogic";
import { opensOptionsByDefault } from "../src/screens/sources/sourcesScreenLogic";

describe("issue #83 UX nits", () => {
  it("separates thousands in shapes", () => {
    expect(fmtCount(55603)).toBe("55,603");
    expect(formatShape([55603, 12])).toBe("55,603 × 12");
  });

  it("collapses CSV options unless the upload failed", () => {
    const csv = { kind: "csv", path: "a.csv" } as never;
    expect(opensOptionsByDefault(csv, null, 12)).toBe(false);
    expect(opensOptionsByDefault(csv, "boom", 0)).toBe(true);
    expect(opensOptionsByDefault(csv, null, 0)).toBe(true);
  });

  it("puts legend above the plot and enables axis automargin", () => {
    const out = dockFigureLayout({ showlegend: true }, 2) as { legend: { orientation: string }; xaxis: { automargin: boolean }; yaxis: { automargin: boolean } };
    expect(out.legend.orientation).toBe("h");
    expect(out.xaxis.automargin).toBe(true);
    expect(out.yaxis.automargin).toBe(true);
    expect(dockFigureLayout({}, 1).legend).toBeUndefined();
  });

  it("writes Python examples with the frame's columns", () => {
    const ins = formulaPyExamples(["ledd", "ra"]).map((e) => e.insert);
    expect(ins).toContain("1 if ledd < 18 else 0");
    expect(ins).toContain("np.log1p(ra)");
    expect(formulaPyExamples([])[0]!.insert).toContain("Age");
  });

  it("impute never offers target, nor the imputed column as By", () => {
    const cols = [
      { name: "a", kind: "float" },
      { name: "b", kind: "float" },
      { name: "target", kind: "int" },
    ] as never;
    const names = (key: string) =>
      imputeOfferedColumns("impute", key, cols, { columns: ["a"] }, "target").map(
        (c) => c.name,
      );
    expect(names("columns")).toEqual(["a", "b"]);
    expect(names("order")).toEqual(["a", "b"]);
    expect(names("by")).toEqual(["b"]);
    expect(
      imputeOfferedColumns("drop_columns", "columns", cols, {}, "target"),
    ).toHaveLength(3);
  });
});
