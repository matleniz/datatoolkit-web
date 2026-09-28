import { expect, test } from "@playwright/test";
import { captureFlowScreenshot, clearFlowScreenshots } from "./helpers";

test("Flow 2c: value_mismatch income labels → map on test → match", async ({
  page,
}) => {
  clearFlowScreenshots("2c-align-values");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.__DTK_DISPATCH__ === "function",
  );

  const { adultAlignWorkspace } = await import("./helpers");
  const ws = adultAlignWorkspace();

  await page.evaluate((workspace) => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_WORKSPACE", workspace });
    d({ type: "SET_SCREEN", screen: "align" });
    d({ type: "CLEAR_SELECTION" });
  }, ws);
  await page.waitForFunction(async () => {
    const p = window.__DTK_WORKSPACE_SAVED__;
    if (!p) return false;
    await p;
    return true;
  });

  await expect(
    page.getByRole("main").getByText("Train / test alignment"),
  ).toBeVisible();

  // income row flagged as value mismatch / to decide
  const incomeRow = page.locator(".align-table-row", { hasText: "income" });
  await expect(incomeRow).toBeVisible({ timeout: 60_000 });
  await expect(incomeRow.getByText("value mismatch")).toBeVisible();
  await expect(page.getByText(/to decide/)).toBeVisible();
  await expect(page.getByText("0 to decide")).toHaveCount(0);

  await expect(incomeRow.getByLabel("Test-only values")).toBeVisible();
  await expect(
    incomeRow.getByLabel("Test-only values").getByText("<=50K.", { exact: true }),
  ).toBeVisible();
  await expect(
    incomeRow.getByLabel("Test-only values").getByText(">50K.", { exact: true }),
  ).toBeVisible();
  await expect(incomeRow.getByText(/% of test rows unseen/)).toBeVisible();
  await expect(incomeRow.locator(".align-fix-hint")).toBeVisible();

  const mapBtn = incomeRow.getByRole("button", { name: "Map on test" });
  await expect(mapBtn).toBeVisible();
  await expect(
    incomeRow.getByRole("button", { name: "Standardize text on test" }),
  ).toBeVisible();

  await captureFlowScreenshot(page, "2c-align-values", "01-value-mismatch.png");

  await mapBtn.click();
  await expect(
    page.getByText(/standardize_text · income · map/),
  ).toBeVisible();

  // Re-check: income should match; 0 to decide
  await expect(page.getByText("0 to decide")).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText("Train and test have the same columns and types."),
  ).toBeVisible();

  const incomeAfter = page.locator(".align-table-row", { hasText: "income" });
  await expect(incomeAfter.getByText("match")).toBeVisible();
  await expect(incomeAfter.getByText("value mismatch")).toHaveCount(0);

  await captureFlowScreenshot(page, "2c-align-values", "02-after-map.png");
});
