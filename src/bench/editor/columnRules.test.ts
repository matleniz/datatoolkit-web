import { describe, expect, it } from "vitest";

import {
  columnRulesProblem,
  dtypeOfKind,
  parseAllowed,
  parseBound,
  patchRule,
} from "./columnRules";

describe("columnRules", () => {
  it("types bounds and allowed values by dtype", () => {
    expect(parseBound("40", "numeric")).toBe(40);
    expect(parseBound("2024-01-01", "datetime")).toBe("2024-01-01");
    expect(parseBound(" ", "numeric")).toBeUndefined();
    expect(parseAllowed("1, 2", "numeric")).toEqual([1, 2]);
    expect(parseAllowed("true,false", "bool")).toEqual([true, false]);
    expect(parseAllowed("pro, basic", undefined)).toEqual(["pro", "basic"]);
    expect(parseAllowed("", "string")).toBeUndefined();
  });

  it("maps column kinds to rule dtypes", () => {
    expect(dtypeOfKind("number")).toBe("numeric");
    expect(dtypeOfKind("date")).toBe("datetime");
    expect(dtypeOfKind("identifier")).toBeUndefined();
  });

  it("drops a key patched to undefined", () => {
    expect(patchRule({ name: "a", unique: true }, { unique: undefined })).toEqual({ name: "a" });
  });

  it("flags unnamed and duplicated rules", () => {
    expect(columnRulesProblem({ columns: [{ name: "" }] })).toBe("Name every column rule");
    expect(columnRulesProblem({ columns: [{ name: "a" }, { name: "a" }] })).toBe("Two rules for column a");
    expect(columnRulesProblem({ columns: [{ name: "a" }] })).toBeNull();
    expect(columnRulesProblem({})).toBeNull();
  });
});
