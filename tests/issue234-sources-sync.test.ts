import { describe, expect, it } from "vitest";
import type { Workspace } from "../src/api/types";
import { sourcesWorkspaceToSync } from "../src/screens/sources/sourcesScreenLogic";

const ws = (name: string, path: string, target?: string): Workspace => ({
  name,
  datasets: {
    train: {
      x: { kind: "csv", path },
      ...(target ? { target_column: target } : {}),
    },
  },
  label: { mode: "order" },
  merges: [],
  variables: [],
  steps: [],
  charts: [],
});
const serialize = (w: Workspace) => JSON.stringify(w);

describe("sourcesWorkspaceToSync (#234)", () => {
  const base = { canNavigate: true, serialize };

  it("returns the built workspace when Sources changed the stored one", () => {
    const built = ws("a", "/u/a.csv", "plan");
    expect(
      sourcesWorkspaceToSync({ ...base, built, current: ws("a", "") }),
    ).toBe(built);
  });

  it("returns null when already in sync", () => {
    const built = ws("a", "/u/a.csv");
    expect(
      sourcesWorkspaceToSync({ ...base, built, current: ws("a", "/u/a.csv") }),
    ).toBeNull();
  });

  it("never syncs while loading, without a train path, or across names", () => {
    const built = ws("a", "/u/a.csv");
    expect(
      sourcesWorkspaceToSync({
        ...base,
        canNavigate: false,
        built,
        current: ws("a", ""),
      }),
    ).toBeNull();
    expect(
      sourcesWorkspaceToSync({ ...base, built: ws("a", ""), current: ws("a", "/x") }),
    ).toBeNull();
    expect(
      sourcesWorkspaceToSync({ ...base, built, current: ws("b", "") }),
    ).toBeNull();
    expect(sourcesWorkspaceToSync({ ...base, built, current: null })).toBeNull();
  });
});
