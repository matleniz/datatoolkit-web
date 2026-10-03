import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Workspace } from "../src/api/types";
import {
  initialSourcesFor,
  sourcesFromWorkspace,
  storedSourcesToLoad,
} from "../src/screens/sources/sourcesScreenLogic";

const UP = "/data/dtk/uploads/abc";

/** The demo churn workspace as bootstrap.ts stores it (upload paths). */
const churn: Workspace = {
  name: "churn",
  datasets: {
    train: {
      x: { kind: "csv", path: `${UP}/churn_train.csv` },
      y: { kind: "csv", path: `${UP}/churn_labels.csv` },
    },
    test: { x: { kind: "csv", path: `${UP}/churn_test.csv`, decimal: "," } },
  },
  label: { mode: "order" },
  merges: [
    {
      source: { kind: "csv", path: `${UP}/customers_extra.csv` },
      key: "customer_id",
      apply_to: "both",
    },
  ],
  variables: [],
  steps: [],
};

const paths = (s: ReturnType<typeof initialSourcesFor>) =>
  s.files.map((f) => f.spec.path);

describe("Sources initial state on a fresh session (datatoolkit-issues#123)", () => {
  it("uses the stored workspace's paths when nothing is cached", () => {
    const src = initialSourcesFor("churn", {}, churn);
    expect(paths(src)).toEqual([
      `${UP}/churn_train.csv`,
      `${UP}/churn_labels.csv`,
      `${UP}/churn_test.csv`,
      `${UP}/customers_extra.csv`,
    ]);
    expect(storedSourcesToLoad("churn", {}, churn)).toBe(churn);
  });

  it("drops a stale cache that no longer describes the stored workspace", () => {
    const stale = sourcesFromWorkspace({
      ...churn,
      datasets: { train: { x: { kind: "csv", path: "/home/runner/x.csv" } } },
      merges: [],
    });
    const src = initialSourcesFor("churn", { churn: stale }, churn);
    expect(paths(src)[0]).toBe(`${UP}/churn_train.csv`);
    expect(storedSourcesToLoad("churn", { churn: stale }, churn)).toBe(churn);
  });

  it("keeps a cache that matches the stored workspace, no reload", () => {
    const cached = sourcesFromWorkspace(churn);
    expect(initialSourcesFor("churn", { churn: cached }, churn)).toBe(cached);
    expect(storedSourcesToLoad("churn", { churn: cached }, churn)).toBeNull();
  });

  it("never invents files for a workspace with no stored sources", () => {
    expect(initialSourcesFor("churn", {}, null).files).toEqual([]);
    expect(initialSourcesFor("other", {}, churn).files).toEqual([]);
    expect(storedSourcesToLoad("other", {}, churn)).toBeNull();
  });
});

/** Every .ts / .tsx file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("no build-machine path in the app bundle (datatoolkit-issues#123)", () => {
  it("app code and vite configs never reference e2e fixtures or bake a path", () => {
    const files = [...sourceFiles("src"), "vite.config.ts", "e2e/vite.e2e.config.ts"];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/__DTK_E2E_FIXTURES__|e2eFixtures|e2e\/fixtures/);
      // A `define` computed from a filesystem path lands verbatim in dist.
      expect(text, f).not.toMatch(/define:\s*\{[^}]*(dirname|join|resolve)\(/);
    }
  });
});
