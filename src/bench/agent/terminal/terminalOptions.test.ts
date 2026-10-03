import { describe, expect, it } from "vitest";

import { parseTerminalPacks } from "./terminalOptions";

describe("parseTerminalPacks", () => {
  it("keeps only terminal packs, with their availability and reason", () => {
    expect(
      parseTerminalPacks({
        packs: [
          { id: "agent-sdk", panel: "chat", available: true },
          { id: "claude-code", title: "Claude Code", panel: "terminal", available: true, reason: null },
          { id: "gemini", panel: "terminal", available: false, reason: "terminal off: set DTK_AGENT_TERMINAL=1" },
          { panel: "terminal" },
        ],
      }),
    ).toEqual([
      { id: "claude-code", title: "Claude Code", available: true, reason: null },
      { id: "gemini", title: "gemini", available: false, reason: "terminal off: set DTK_AGENT_TERMINAL=1" },
    ]);
  });
  it("tolerates a malformed body", () => {
    expect(parseTerminalPacks(null)).toEqual([]);
    expect(parseTerminalPacks({ packs: "x" })).toEqual([]);
  });
});
