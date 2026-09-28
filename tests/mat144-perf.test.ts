import { describe, expect, it } from "vitest";

import { InFlightDedupe } from "../src/api/requestDedupe";
import { formulaPlaceholder } from "../src/bench/editor/formulaPlaceholder";
import { defaultExportOutDir } from "../src/bench/export/exportPaths";
import { keyParamsFromSchema } from "../src/bench/left/keyParams";
import type { Workspace } from "../src/api/types";

describe("keyParamsFromSchema", () => {
  it("only passes properties declared on the schema", () => {
    const schema = {
      type: "object" as const,
      properties: {
        source: { type: "object" as const },
        columns: { type: "array" as const },
      },
    };
    const available = {
      source: { kind: "dataset", workspace: "pk" },
      test: { kind: "dataset", workspace: "pk", role: "test" },
      columns: ["age"],
      target: "churn",
    };
    expect(keyParamsFromSchema(schema, available)).toEqual({
      source: available.source,
      columns: ["age"],
    });
  });

  it("omits undefined available values", () => {
    const schema = {
      properties: {
        source: {},
        test: {},
      },
    };
    expect(
      keyParamsFromSchema(schema, {
        source: { kind: "dataset", workspace: "a" },
        test: undefined,
      }),
    ).toEqual({ source: { kind: "dataset", workspace: "a" } });
  });
});

describe("formulaPlaceholder", () => {
  it("uses a numeric column and variable when both exist", () => {
    expect(
      formulaPlaceholder(
        [
          { name: "patient_id", kind: "identifier" },
          { name: "age", kind: "number" },
        ],
        [{ name: "age_med" }],
      ),
    ).toBe("age - @age_med");
  });

  it("falls back to a generic pattern", () => {
    expect(formulaPlaceholder([], [])).toBe("col - @var");
    expect(
      formulaPlaceholder([{ name: "spend", kind: "number" }], []),
    ).toBe("spend - @spend_med");
  });
});

describe("defaultExportOutDir", () => {
  it("derives $DTK_HOME/exports/<name> from an uploads path", () => {
    const ws = {
      name: "parkinson",
      datasets: {
        train: {
          x: {
            kind: "csv",
            path: "/tmp/dtk-abc/uploads/deadbeef/X_train.csv",
          },
        },
      },
      label: { mode: "order" },
      merges: [],
      variables: [],
      steps: [],
    } as Workspace;
    expect(defaultExportOutDir(ws)).toBe("/tmp/dtk-abc/exports/parkinson");
  });

  it("falls back to /tmp/exports/<name>", () => {
    const ws = {
      name: "churn",
      datasets: {
        train: { x: { kind: "csv", path: "./local.csv" } },
      },
      label: { mode: "order" },
      merges: [],
      variables: [],
      steps: [],
    } as Workspace;
    expect(defaultExportOutDir(ws)).toBe("/tmp/exports/churn");
  });
});

describe("InFlightDedupe", () => {
  it("shares one promise for identical keys", async () => {
    const d = new InFlightDedupe();
    let runs = 0;
    const run = () =>
      d.run("GET\0/x\0", async () => {
        runs += 1;
        await new Promise((r) => setTimeout(r, 20));
        return "ok";
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(a).toBe("ok");
    expect(b).toBe("ok");
    expect(runs).toBe(1);
  });
});
