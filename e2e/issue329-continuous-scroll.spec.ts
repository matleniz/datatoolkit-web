import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Workspace } from "../src/api/types";

const shots = join(dirname(fileURLToPath(import.meta.url)), "screenshots", "continuous-scroll");
const N = 60_000;

/** A CSV on the duckdb engine: `id` is the row position, so any row can be checked. */
function bigWorkspace(): Workspace {
  const dir = mkdtempSync(join(tmpdir(), "dtk-scroll-"));
  const path = join(dir, "rows.csv");
  const lines = ["id,age,city,income"];
  for (let i = 0; i < N; i++) lines.push(`${i},${20 + (i % 60)},city${i % 7},${(i * 37) % 1000}.5`);
  writeFileSync(path, lines.join("\n") + "\n");
  return {
    name: "scroll329",
    datasets: { train: { x: { kind: "csv", path, engine: "duckdb" } } },
    label: { mode: "order" },
    merges: [],
    variables: [],
    groups: [],
    steps: [],
  };
}

async function open(page: Page, workspace: Workspace) {
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__DTK_DISPATCH__ === "function");
  await page.evaluate((ws) => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_WORKSPACE", workspace: ws });
    d({ type: "SET_SCREEN", screen: "bench" });
  }, workspace);
  await expect(page.locator(".grid-vbody")).toBeVisible({ timeout: 120_000 });
}

/** Real rows are mounted and no placeholder is left (the scroll event has been handled). */
const settled = async (page: Page, movedFrom?: string | null) => {
  if (movedFrom) await expect(page.locator(".grid-vbody")).not.toHaveAttribute("data-window", movedFrom);
  await expect(page.locator(".grid-vwindow .sk-grid-row")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".grid-row").first()).toBeVisible();
};

test("duckdb frame: rows are windowed, prefetched and bounded in memory (#329)", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(shots, { recursive: true });
  await open(page, bigWorkspace());
  await settled(page);
  const grid = page.getByLabel("Data grid");
  const body = page.locator(".grid-vbody");

  await expect(page.locator(".grid-vfooter-text")).toContainText(`of ${N.toLocaleString("en-US")}`);
  // Only the rows under the viewport are mounted, never the 60k.
  expect(await page.locator(".grid-row").count()).toBeLessThan(40);
  // A real row has the placeholder's box: 30px + 1px border.
  const h = await page.locator(".grid-row").first().evaluate((e) => e.getBoundingClientRect().height);
  expect(h).toBe(31);
  // Approximate kind is marked, discreetly.
  await expect(page.locator(".grid-th .approx-mark").first()).toBeVisible();

  const checkRowsMatchIndex = async () => {
    const rows = await page.locator(".grid-row").evaluateAll((els) =>
      els.map((e) => [Number((e as HTMLElement).dataset.rowIndex), e.querySelector(".grid-td")?.textContent]),
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const [i, id] of rows) expect(id).toBe(String(i));
  };
  await checkRowsMatchIndex();

  // Jump deep, then to the end: rows load, and the cache stays bounded.
  for (const frac of [0.5, 0.83, 1]) {
    const before = await body.getAttribute("data-window");
    await grid.evaluate((e, f) => (e.scrollTop = (e.scrollHeight - e.clientHeight) * f), frac);
    await settled(page, before);
    await checkRowsMatchIndex();
    expect(Number(await body.getAttribute("data-pages"))).toBeLessThanOrEqual(24);
  }
  await expect(page.locator('.grid-row[data-row-index="59999"]')).toHaveCount(1);
  await page.screenshot({ path: join(shots, "end.png") });

  // Slow scrolling with look-ahead: after the first settle no placeholder shows.
  const before = await body.getAttribute("data-window");
  await grid.evaluate((e) => (e.scrollTop = 0));
  await settled(page, before);
  const seen: number[] = [];
  const box = (await grid.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 120);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 80)));
    seen.push(await page.locator(".grid-vwindow .sk-grid-row").count());
  }
  expect(seen.filter((n) => n > 0).length).toBeLessThanOrEqual(2);
  await checkRowsMatchIndex();
});
