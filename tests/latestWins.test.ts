import { describe, expect, it } from "vitest";

import { createLatestWins } from "../src/screens/sources/latestWins";

describe("createLatestWins (#244)", () => {
  it("only the most recent ticket is current", () => {
    const gate = createLatestWins();
    const mount = gate.next();
    expect(gate.isCurrent(mount)).toBe(true);
    // the user creates a workspace (optimistic stub applied) while the
    // mount-time list is still on the wire
    gate.next();
    expect(gate.isCurrent(mount)).toBe(false);
  });

  it("a later fetch supersedes an earlier one that answers last", () => {
    const gate = createLatestWins();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isCurrent(second)).toBe(true);
    expect(gate.isCurrent(first)).toBe(false);
  });
});
