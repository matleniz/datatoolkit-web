import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|css|md)$/.test(name)) out.push(p);
  }
  return out;
}

describe("front isolation", () => {
  it("nothing under src/ mentions dtk_engine", () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      if (/\bdtk_engine\b/.test(text)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});
