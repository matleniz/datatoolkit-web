import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const e2eDir = dirname(fileURLToPath(import.meta.url));
const sourcesScreenshotsDir = join(e2eDir, "screenshots/sources");
const alignScreenshotsDir = join(e2eDir, "screenshots/align");
const docsW1ScreenshotsDir = join(e2eDir, "../docs/screenshots/w1-sources-align");

test.beforeAll(() => {
  mkdirSync(sourcesScreenshotsDir, { recursive: true });
  mkdirSync(alignScreenshotsDir, { recursive: true });
  mkdirSync(docsW1ScreenshotsDir, { recursive: true });
});

test("full sources and alignment flow with fixtures and screenshots", async ({
  page,
}) => {
  // Set viewport to match prototype desktop design
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Load Sources screen
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible();
  await expect(page.getByText("Sources of “churn”")).toBeVisible();

  // Verify Files list
  const filesList = page.getByRole("region", { name: "Files list" });
  await expect(filesList.getByText("churn_train.csv")).toBeVisible();
  await expect(filesList.getByText("churn_labels.csv")).toBeVisible();
  await expect(filesList.getByText("churn_test.csv")).toBeVisible();
  await expect(filesList.getByText("customers_extra.csv")).toBeVisible();

  // Verify Target and Merge cards
  await expect(page.getByRole("button", { name: "Separate y file" })).toBeVisible();
  await expect(page.getByRole("button", { name: "By row order" })).toBeVisible();
  const mergeRegion = page.getByRole("region", { name: "Merge settings" });
  await expect(mergeRegion.getByText("Merge", { exact: true })).toBeVisible();
  await expect(mergeRegion.getByText("Also merge into test: yes")).toBeVisible();

  // Verify Result card with shapes
  await expect(page.getByText(/train 20 ×/)).toBeVisible();
  await expect(page.getByText(/test 6 ×/)).toBeVisible();

  // Capture Sources Screen screenshot
  await page.screenshot({
    path: join(sourcesScreenshotsDir, "sources_screen.png"),
    fullPage: true,
  });
  await page.screenshot({
    path: join(docsW1ScreenshotsDir, "sources_screen.png"),
    fullPage: true,
  });

  // 2. Navigate to Alignment screen
  await page.getByRole("button", { name: "Check train / test alignment →" }).click();
  await expect(page.getByRole("main").getByText("Train / test alignment")).toBeVisible();

  // Verify initial alignment state
  await expect(page.getByText("to decide")).toBeVisible();
  await expect(page.getByText("Test stores numbers as text with a comma decimal.")).toBeVisible();

  // Action buttons visible
  const rereadBtn = page.getByRole("button", {
    name: 'Re-read test with decimal ","',
  });
  await expect(rereadBtn).toBeVisible();

  const renameBtn = page.getByRole("button", {
    name: "↔ nb_support_calls (similar name)",
  });
  await expect(renameBtn).toBeVisible();

  // promo_code candidate button is kept but not labelled (similar name)
  await expect(
    page.getByRole("button", { name: "↔ promo_code", exact: true }),
  ).toBeVisible();

  const dropPromoTestBtn = page
    .locator(".align-table-row", { hasText: "promo_code" })
    .getByRole("button", { name: "Drop from test" });
  await expect(dropPromoTestBtn).toBeVisible();

  // Verify "Cast test to float" is disabled because comma decimal is present
  const castFloatBtn = page.getByRole("button", {
    name: "Cast test to float",
  });
  await expect(castFloatBtn).toBeDisabled();

  // Capture Alignment Screen Initial screenshot
  await page.screenshot({
    path: join(alignScreenshotsDir, "align_screen_initial.png"),
    fullPage: true,
  });
  await page.screenshot({
    path: join(docsW1ScreenshotsDir, "align_screen_initial.png"),
    fullPage: true,
  });

  // 3. Apply fixes
  // Fix 1: Re-read test with decimal ","
  await rereadBtn.click();
  await expect(
    page.getByText('churn_test.csv · decimal ","'),
  ).toBeVisible();

  // Fix 2: Rename nb_support_calls to support_calls
  await renameBtn.click();
  await expect(
    page.getByText("rename · nb_support_calls → support_calls · test"),
  ).toBeVisible();

  // Fix 3: Drop promo_code from test
  await dropPromoTestBtn.click();
  await expect(
    page.getByText("drop_columns · promo_code · test"),
  ).toBeVisible();

  // Verify all differ columns resolved
  await expect(
    page.getByText("Train and test have the same columns and types."),
  ).toBeVisible();
  await expect(page.getByText("0 to decide")).toBeVisible();

  // Capture Alignment Screen Aligned screenshot
  await page.screenshot({
    path: join(alignScreenshotsDir, "align_screen_aligned.png"),
    fullPage: true,
  });
  await page.screenshot({
    path: join(docsW1ScreenshotsDir, "align_screen_aligned.png"),
    fullPage: true,
  });

  // 4. Navigate to Workbench
  await page.getByRole("button", { name: "Open workbench →" }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible();
  await expect(page.getByLabel("Pipeline")).toBeVisible();

  // Capture Workbench Aligned screenshot
  await page.screenshot({
    path: join(alignScreenshotsDir, "workbench_aligned.png"),
    fullPage: true,
  });
  await page.screenshot({
    path: join(docsW1ScreenshotsDir, "workbench_aligned.png"),
    fullPage: true,
  });
});
