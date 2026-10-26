import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { churnWorkspace, waitForGridReady } from "./helpers";

const shots = join(dirname(fileURLToPath(import.meta.url)), "screenshots", "placeholders");

/** Hold matching engine calls until `release()`: the page stays in its pending state. */
function gate(page: Page, pattern: RegExp) {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  const held: Route[] = [];
  const ready = page.route(pattern, async (route) => {
    held.push(route);
    await opened;
    await route.continue().catch(() => undefined);
  });
  return { ready, release: () => open(), held };
}

async function shot(page: Page, name: string) {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, name) });
}

async function openBenchWithoutWaiting(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__DTK_DISPATCH__ === "function");
}

async function dispatchBench(page: Page) {
  await page.evaluate((workspace) => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_WORKSPACE", workspace });
    d({ type: "SET_SCREEN", screen: "bench" });
    d({ type: "CLEAR_SELECTION" });
  }, churnWorkspace());
}

const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

test("grid: placeholder rows have the real row box (no layout shift on arrival)", async ({ page }) => {
  test.setTimeout(180_000);
  await openBenchWithoutWaiting(page);
  const rows = gate(page, /\/workspace\/rows/);
  const profiles = gate(page, /\/workspace\/profiles/);
  await rows.ready;
  await profiles.ready;
  await dispatchBench(page);

  const grid = page.getByLabel("Data grid");
  await expect(page.locator(".sk-grid-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(grid).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".grid-row")).toHaveCount(0);
  await expect(grid.getByRole("status")).toContainText("Loading rows");
  const skRow = await box(page, ".sk-grid-row");
  const skInner = await box(page, ".grid-inner");
  await shot(page, "grid-rows-placeholder.png");

  rows.release();
  await expect(page.locator(".grid-row").first()).toBeVisible({ timeout: 30_000 });
  // Profiles still pending: the header histograms shimmer in place.
  await expect(page.locator(".grid-th .sk").first()).toBeVisible();
  await shot(page, "grid-profile-placeholder.png");
  const headerBefore = await box(page, ".grid-header-row");

  profiles.release();
  await waitForGridReady(page);
  await expect(page.locator(".grid-th .sk")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".sk-grid-row")).toHaveCount(0);
  await shot(page, "grid-loaded.png");

  const row = await box(page, ".grid-row");
  const headerAfter = await box(page, ".grid-header-row");
  expect(row.height).toBe(skRow.height);
  expect(row.y).toBe(skRow.y);
  expect(row.x).toBe(skRow.x);
  expect(headerAfter).toEqual(headerBefore);
  expect((await box(page, ".grid-inner")).x).toBe(skInner.x);
});

test("suggestions: card placeholders, then the cards", async ({ page }) => {
  test.setTimeout(180_000);
  await openBenchWithoutWaiting(page);
  const keys = gate(page, /\/keys\/[^/]+\/run/);
  await keys.ready;
  await dispatchBench(page);
  await waitForGridReady(page);

  const placeholder = page.locator(".sug-skeleton");
  await expect(placeholder).toBeVisible({ timeout: 30_000 });
  await expect(placeholder).toHaveAttribute("role", "status");
  await expect(placeholder).toContainText("Loading suggestions");
  await expect(placeholder.locator(".sug-card-sk")).toHaveCount(3);
  const before = await box(page, ".sug-skeleton");
  await shot(page, "suggestions-placeholder.png");

  keys.release();
  await expect(page.locator(".sug-card[data-sug-id]").first()).toBeVisible({ timeout: 60_000 });
  await expect(placeholder).toHaveCount(0);
  const after = await box(page, ".sug-list");
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  await shot(page, "suggestions-loaded.png");
});

test("stats and analysis windows: value placeholders keep the matrix cell box", async ({ page }) => {
  test.setTimeout(180_000);
  await openBenchWithoutWaiting(page);
  await dispatchBench(page);
  await waitForGridReady(page);
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "PICK_COL", name: "age" });
    d({ type: "PICK_COL", name: "monthly_spend", add: true });
  });
  const keys = gate(page, /\/keys\/(column_distribution|correlations)\/run/);
  await keys.ready;
  await page.getByRole("button", { name: "Compare columns" }).click();
  const win = page.locator('[data-tool="compare"]');
  await expect(win.locator('.matrix[data-stats-state="loading"]')).toBeVisible({ timeout: 30_000 });
  await expect(win.locator(".matrix-cell .sk").first()).toBeVisible();
  await expect(win.getByRole("status")).toContainText("Computing statistics");
  const cell = win.locator('.matrix-cell[data-stat="mean"][data-col="age"]');
  const before = (await cell.boundingBox())!;
  const matrixBefore = (await win.locator(".matrix").boundingBox())!;
  await shot(page, "stats-placeholder.png");

  keys.release();
  await expect(win.locator('.matrix[data-stats-state="ready"]')).toBeVisible({ timeout: 60_000 });
  await expect(win.locator(".matrix-cell .sk")).toHaveCount(0);
  expect(await cell.boundingBox()).toEqual(before);
  expect(await win.locator(".matrix").boundingBox()).toEqual(matrixBefore);
  await shot(page, "stats-loaded.png");
});

test("analysis window: skeleton while the result is awaited", async ({ page }) => {
  test.setTimeout(180_000);
  await openBenchWithoutWaiting(page);
  await dispatchBench(page);
  await waitForGridReady(page);
  const keys = gate(page, /\/keys\/correlations\/run/);
  await keys.ready;
  await page.getByRole("button", { name: "Correlation matrix" }).click();
  const win = page.locator('[data-tool="corr"]');
  await expect(win.locator(".dock-skeleton")).toBeVisible({ timeout: 30_000 });
  await expect(win.locator(".dock-skeleton")).toContainText("Loading…");
  await shot(page, "analysis-placeholder.png");
  keys.release();
  await expect(win.locator('[data-engine-key="correlations"]')).toBeVisible({ timeout: 60_000 });
  await expect(win.locator(".dock-skeleton")).toHaveCount(0);
  await shot(page, "analysis-loaded.png");
});

test("sources: result card placeholders while the files are inspected", async ({ page }) => {
  test.setTimeout(180_000);
  await openBenchWithoutWaiting(page);
  const cols = gate(page, /\/(source\/columns|workspace\/preview)$/);
  await cols.ready;
  await page.evaluate((workspace) => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_WORKSPACE", workspace });
    d({ type: "SET_SCREEN", screen: "sources" });
  }, { ...churnWorkspace(), name: "churn-sk" });
  const card = page.getByLabel("Result schema");
  await expect(card.locator(".res-chips [role=status]")).toContainText("Loading the columns", { timeout: 30_000 });
  const before = (await card.boundingBox())!;
  const rowHeights = () => page.locator(".files-table-row").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  const rowsBefore = await rowHeights();
  await expect(page.locator(".file-cols .sk").first()).toBeVisible();
  await card.screenshot({ path: join(shots, "sources-card-placeholder.png") });
  await shot(page, "sources-placeholder.png");
  cols.release();
  await expect(card.locator(".res-col-chip").first()).toBeVisible({ timeout: 60_000 });
  await expect(card.locator(".sk")).toHaveCount(0);
  await card.screenshot({ path: join(shots, "sources-card-loaded.png") });
  await shot(page, "sources-loaded.png");
  // The card keeps its own box, and every file row keeps its height.
  const after = (await card.boundingBox())!;
  expect(after.height).toBe(before.height);
  expect(await rowHeights()).toEqual(rowsBefore);
});
