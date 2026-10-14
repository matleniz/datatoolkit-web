import { describe, expect, it } from "vitest";

import { isLongPaste, pastedName, pasteThreshold } from "../src/bench/agent/attachments/pasteAttach";

describe("paste-to-attachment threshold (#194)", () => {
  it("defaults to 4000 and honours a valid override", () => {
    expect(pasteThreshold(undefined)).toBe(4000);
    expect(pasteThreshold("abc")).toBe(4000);
    expect(pasteThreshold("-5")).toBe(4000);
    expect(pasteThreshold("100")).toBe(100);
  });
  it("only pastes strictly longer than the threshold attach", () => {
    expect(isLongPaste("a".repeat(4000), 4000)).toBe(false);
    expect(isLongPaste("a".repeat(4001), 4000)).toBe(true);
  });
  it("names pasted files uniquely", () => {
    expect(pastedName([])).toBe("pasted-text-1.txt");
    expect(pastedName(["pasted-text-1.txt", "x.csv"])).toBe("pasted-text-2.txt");
  });
});
