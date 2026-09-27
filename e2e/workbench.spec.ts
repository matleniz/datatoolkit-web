import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const shotDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "screenshots/workbench",
);
const docsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../docs/screenshots/w2-workbench-core",
);

async function openBench(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible();
  await expect(page.getByLabel("Data grid")).toBeVisible({ timeout: 30_000 });
  // Wait for age header (data loaded)
  await expect(page.locator(".grid-th", { hasText: "age" })).toBeVisible({
    timeout: 30_000,
  });
}

test.beforeAll(() => {
  mkdirSync(shotDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
});

test("workbench: replace sentinels → impute → one-hot → time travel → delete", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBench(page);

  await page.screenshot({
    path: join(shotDir, "01-grid.png"),
    fullPage: true,
  });

  // Right-click age → Replace sentinels
  const ageHeader = page.locator(".grid-th", { hasText: "age" }).first();
  await ageHeader.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Column menu" })).toBeVisible();
  await page.getByRole("menuitem", { name: /Replace sentinels/ }).click();
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(page.getByText("Learned on train", { exact: true })).toBeVisible();
  // Stateless op — "Nothing: stateless" or empty state
  await expect(page.getByRole("button", { name: "Apply step" }).first()).toBeEnabled({
    timeout: 15_000,
  });
  await page.screenshot({
    path: join(shotDir, "02-replace-sentinels-editor.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Apply step" }).first().click();
  await expect(page.getByText("v1")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({
    path: join(docsDir, "replace-sentinels.png"),
    fullPage: true,
  });

  // Impute age — schema fields + learned fill visible
  await ageHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Impute/ }).click();
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(page.getByText("Strategy", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "median" })).toBeVisible();
  await expect(page.getByRole("button", { name: "most_frequent" })).toBeVisible();
  await expect(page.getByText("Add Indicator", { exact: true })).toBeVisible();
  await expect(page.getByText("Learned on train", { exact: true })).toBeVisible();
  await expect(page.locator(".ed-learned")).toContainText(/fill|age/i, {
    timeout: 15_000,
  });
  await page.screenshot({
    path: join(shotDir, "03-impute-learned.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Apply step" }).first().click();
  await expect(page.getByText("v2")).toBeVisible({ timeout: 15_000 });
  // Pipeline node v2 must show shape, not em-dash
  const v2Node = page.locator(".pipeline-node", { hasText: "v2" }).first();
  await expect(v2Node).toContainText(/20\s*×\s*10/, { timeout: 20_000 });

  // One-hot city with diff — real 0/1 values in added columns
  const cityHeader = page.locator(".grid-th", { hasText: "city" }).first();
  await cityHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: /One-hot/ }).click();
  await expect(page.getByText("Min Frequency", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Drop First", { exact: true })).toBeVisible();
  await expect(page.getByText("Handle Unknown", { exact: true })).toBeVisible();
  await expect(page.getByText("Live preview")).toBeVisible({ timeout: 20_000 });
  const addedCol = page.locator(".grid-th.added").first();
  await expect(addedCol).toBeVisible({ timeout: 15_000 });
  const addedName = ((await addedCol.locator(".th-name").textContent()) ?? "").trim();
  expect(addedName).toMatch(/^city_/);
  // First data cell of the first added column should be 0 or 1, not "missing"
  const firstAddedCell = page
    .locator(".grid-row")
    .first()
    .locator(".grid-td.tone-added")
    .first();
  await expect(firstAddedCell).toBeVisible();
  await expect(firstAddedCell).toHaveText(/^[01]$/);
  await page.screenshot({
    path: join(shotDir, "04-onehot-diff.png"),
    fullPage: true,
  });

  // Toolbar stays on one line at 1440 and 1280
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ] as const) {
    await page.setViewportSize(size);
    const toolbar = page.locator(".grid-toolbar");
    const box = await toolbar.boundingBox();
    expect(box, `toolbar box at ${size.width}`).not.toBeNull();
    expect(box!.height, `toolbar height at ${size.width}`).toBeLessThanOrEqual(48);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Apply step" }).first().click();
  await expect(page.getByText("v3")).toBeVisible({ timeout: 15_000 });

  // Time travel to v1
  await page.locator(".pipeline-node", { hasText: "v1" }).first().click();
  await expect(page.getByText("Time travel")).toBeVisible();
  await page.screenshot({
    path: join(shotDir, "05-time-travel.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back to latest" }).click();
  await expect(page.getByText("Time travel")).toHaveCount(0);

  // Delete last step via ×
  const removeBtns = page.getByRole("button", {
    name: "Remove this step and replay",
  });
  const n = await removeBtns.count();
  expect(n).toBeGreaterThan(0);
  await removeBtns.last().click();
  await expect(page.locator(".pipeline-ver", { hasText: "v3" })).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.screenshot({
    path: join(shotDir, "06-after-delete.png"),
    fullPage: true,
  });
  await page.screenshot({
    path: join(docsDir, "workbench.png"),
    fullPage: true,
  });
});
