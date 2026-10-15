import { describe, expect, it } from "vitest";

import { dataIdentity } from "../src/bench/dataIdentity";
import { FrameCache } from "../src/bench/frameCache";
import type { Workspace } from "../src/api/types";

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    name: "w",
    datasets: {
      train: { x: { kind: "csv", path: "/d/train.csv" } },
      test: { x: { kind: "csv", path: "/d/test.csv" } },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [{ op: "drop_columns", target: "both", params: { columns: ["a"] } }],
    ...over,
  } as Workspace;
}

const key = (w: Workspace, role: "train" | "test", v: number | null = null) =>
  `${dataIdentity(w, role, v).key}|`;

describe("FrameCache", () => {
  it("hits on the same key and keeps train / test apart", () => {
    const c = new FrameCache<string>();
    const w = ws();
    c.set(key(w, "train"), "train");
    c.set(key(w, "test"), "test");
    expect(c.get(key(ws(), "train"))).toBe("train");
    expect(c.get(key(ws(), "test"))).toBe("test");
  });

  it("misses when the source path, its params or a step changes", () => {
    const c = new FrameCache<string>();
    c.set(key(ws(), "train"), "x");
    const moved = ws({
      datasets: {
        train: { x: { kind: "csv", path: "/d/other.csv" } },
        test: { x: { kind: "csv", path: "/d/test.csv" } },
      },
    });
    const params = ws({
      datasets: {
        train: { x: { kind: "csv", path: "/d/train.csv", decimal: "," } },
        test: { x: { kind: "csv", path: "/d/test.csv" } },
      },
    });
    const step = ws({
      steps: [{ op: "drop_columns", target: "both", params: { columns: ["b"] } }],
    });
    expect(c.get(key(moved, "train"))).toBeUndefined();
    expect(c.get(key(params, "train"))).toBeUndefined();
    expect(c.get(key(step, "train"))).toBeUndefined();
    expect(c.get(key(ws(), "train"))).toBe("x");
  });

  it("keeps an entry when only a later step changes", () => {
    const c = new FrameCache<string>();
    const w = ws();
    c.set(key(w, "train", 1), "v1");
    const more = ws({
      steps: [
        ...w.steps,
        { op: "drop_columns", target: "both", params: { columns: ["z"] } },
      ],
    });
    expect(c.get(key(more, "train", 1))).toBe("v1");
  });

  it("evicts the least recently used entry past capacity", () => {
    const c = new FrameCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });

  it("clear() drops everything (write / upload / reload)", () => {
    const c = new FrameCache<number>();
    c.set("a", 1);
    c.clear();
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0);
  });
});
