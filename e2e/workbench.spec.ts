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

  // Impute age — learned fill visible
  await ageHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Impute/ }).click();
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

  // One-hot city with diff
  const cityHeader = page.locator(".grid-th", { hasText: "city" }).first();
  await cityHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: /One-hot/ }).click();
  await expect(page.getByText("Live preview")).toBeVisible({ timeout: 20_000 });
  await page.screenshot({
    path: join(shotDir, "04-onehot-diff.png"),
    fullPage: true,
  });
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
