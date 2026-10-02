import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Workspace } from "../src/api/types";
import { waitForGridReady } from "./helpers";

/**
 * 1500 rows (the grid loads 500). f1 cycles 0..49, then climbs to 100 over the
 * last 100 rows: its max sits far beyond the loaded rows (and it is not a
 * monotonic id, which the engine would exclude from the matrix).
 */
const N = 1500;
const f1 = (i: number) => (i <= 1400 ? i % 50 : i - 1400);
const F1_MEAN = Array.from({ length: N }, (_, k) => f1(k + 1)).reduce((a, b) => a + b + 0.5, 0) / N;
const FEATURES = 9;

function writeFixture(): string {
  const header = ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "label"];
  const lines = [header.join(",")];
  for (let i = 1; i <= N; i++) {
    const row: number[] = [f1(i) + 0.5];
    for (let k = 2; k <= FEATURES; k++) row.push(((i * k * 7) % 101) + 0.25);
    row.push(f1(i) * 2 + (i % 3) + 0.1);
    lines.push(row.join(","));
  }
  const dir = mkdtempSync(join(tmpdir(), "dtk-issue75-"));
  const path = join(dir, "long_frame.csv");
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

async function open(page: Page, path: string) {
  const ws: Workspace = {
    name: "issue75_full_frame",
    datasets: {
      train: { x: { kind: "csv", path }, target_column: "label" },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__DTK_DISPATCH__ === "function");
  await page.evaluate((workspace) => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_WORKSPACE", workspace });
    d({ type: "SET_SCREEN", screen: "bench" });
    d({ type: "CLEAR_SELECTION" });
  }, ws);
  await page.waitForFunction(async () => {
    const p = window.__DTK_WORKSPACE_SAVED__;
    if (!p) return false;
    await p;
    return true;
  });
  await waitForGridReady(page);
}

test.describe("#75 compare stats on the full frame, #74 matrix columns", () => {
  test("Compare columns shows the full-frame max / mean / r, not the loaded rows'", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page, writeFixture());
    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "f1" });
      d({ type: "PICK_COL", name: "f2", add: true });
    });
    await page.getByRole("button", { name: "Compare columns" }).click();
    const win = page.locator('[data-tool="compare"]');
    await expect(win.locator('.matrix[data-stats-state="ready"]')).toBeVisible({
      timeout: 60_000,
    });
    const cell = (stat: string, col: string) =>
      win.locator(`.matrix-cell[data-stat="${stat}"][data-col="${col}"]`);
    await expect(cell("max", "f1")).toHaveText("100.5");
    await expect(cell("min", "f1")).toHaveText("0.5");
    await expect(cell("mean", "f1")).toHaveText(String(Math.round(F1_MEAN * 1000) / 1000));
    // label = 2·f1 + noise: r is close to 1 on the whole frame.
    const r = Number(await cell(`r with label`, "f1").innerText());
    expect(r).toBeGreaterThan(0.99);
  });

  test("Correlation matrix without a selection keeps all 9 numeric columns", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page, writeFixture());
    await page.getByRole("button", { name: "Correlation matrix" }).click();
    const win = page.locator('[data-tool="corr"]');
    await expect(win.locator('[data-engine-key="correlations"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(win.locator("[data-corr-size]")).toHaveAttribute(
      "data-corr-size",
      String(FEATURES),
      { timeout: 30_000 },
    );
    await expect(win.locator(".dock-bound")).toContainText(
      `key correlations · ${FEATURES} columns`,
    );
  });
});
