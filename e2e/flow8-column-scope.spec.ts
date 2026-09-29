import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openDetails,
  openWorkbench,
  waitForGridReady,
} from "./helpers";

test("MAT-146 / MAT-159: Outliers window follows column selection via engine columns=", async ({
  page,
}) => {
  test.setTimeout(120_000);
  clearFlowScreenshots("8-column-scope");
  await page.setViewportSize({ width: 1440, height: 900 });

  await openWorkbench(page, true);

  // Select one numeric column with known IQR outliers in the churn fixture.
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "CLEAR_SELECTION" });
    d({ type: "PICK_COL", name: "monthly_spend" });
  });

  await page
    .getByRole("navigation", { name: "Analysis tools" })
    .getByRole("button", { name: "Outliers" })
    .click();
  const outliers = page.locator('[data-tool="outliers"]');
  await expect(outliers).toBeVisible();

  await expect(outliers.locator("[data-outliers-col]")).toHaveAttribute(
    "data-outliers-col",
    "monthly_spend",
    { timeout: 30_000 },
  );
  await expect(outliers.locator("[data-scope-mode]")).toHaveAttribute(
    "data-scope-mode",
    "selection",
  );
  // Scoped path uses the engine with columns=[selection] (MAT-159).
  await expect(outliers.locator('[data-engine-key="outliers"]')).toBeVisible({
    timeout: 30_000,
  });
  await openDetails(outliers);
  await expect(outliers.getByText("outliers_per_column")).toBeVisible();
  const scopedTable = outliers.locator(".result-table-block", {
    hasText: "outliers_per_column",
  });
  await expect(scopedTable.getByText("monthly_spend")).toBeVisible();
  await expect(scopedTable.getByText("sessions")).toHaveCount(0);

  await waitForGridReady(page);
  await captureFlowScreenshot(
    page,
    "8-column-scope",
    "01-outliers-monthly-spend.png",
  );

  // Change selection → window follows.
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "CLEAR_SELECTION" });
    d({ type: "PICK_COL", name: "sessions" });
  });

  await expect(outliers.locator("[data-outliers-col]")).toHaveAttribute(
    "data-outliers-col",
    "sessions",
    { timeout: 30_000 },
  );
  await expect(outliers.locator('[data-engine-key="outliers"]')).toBeVisible({
    timeout: 30_000,
  });
  const sessionsTable = outliers.locator(".result-table-block", {
    hasText: "outliers_per_column",
  });
  await expect(sessionsTable.getByText("sessions")).toBeVisible();
  await expect(sessionsTable.getByText("monthly_spend")).toHaveCount(0);
  await expect(outliers.locator('[data-outliers-col="monthly_spend"]')).toHaveCount(
    0,
  );

  await waitForGridReady(page);
  await captureFlowScreenshot(
    page,
    "8-column-scope",
    "02-outliers-sessions.png",
  );

  // Explicit toggle widens to all columns (engine Result — no front filter).
  await outliers
    .getByRole("button", { name: "Widen analysis to all columns" })
    .click();
  await expect(outliers.locator("[data-scope-mode]")).toHaveAttribute(
    "data-scope-mode",
    "all",
    { timeout: 30_000 },
  );
  await expect(outliers.locator('[data-engine-key="outliers"]')).toBeVisible({
    timeout: 30_000,
  });
  await openDetails(outliers);
  await expect(outliers.getByText("outliers_per_column")).toBeVisible();
  const allTable = outliers.locator(".result-table-block", {
    hasText: "outliers_per_column",
  });
  await expect(allTable.getByText("monthly_spend")).toBeVisible();
  await expect(allTable.getByText("sessions")).toBeVisible();
});
