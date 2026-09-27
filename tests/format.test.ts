import { describe, expect, it } from "vitest";
import { cellDisplay, nameDisplay } from "../src/bench/format";

describe("nameDisplay / cellDisplay quoting", () => {
  it("quotes names with leading or trailing spaces like cells", () => {
    expect(nameDisplay("city_Lille")).toBe("city_Lille");
    expect(nameDisplay("city_Lille ")).toBe("“city_Lille ”");
    expect(nameDisplay(" Lille")).toBe("“ Lille”");
    expect(cellDisplay("Lille ")).toBe("“Lille ”");
    expect(cellDisplay("Lille")).toBe("Lille");
  });
});
