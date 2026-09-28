import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkbench,
  waitForGridReady,
} from "./helpers";

test("MAT-146: Outliers window follows column selection", async ({ page }) => {
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
  // Only the selected column appears in the scoped list (row labels or col).
  const cols = outliers.locator(".list-row[data-col]");
  await expect(cols.first()).toBeVisible();
  const colNames = await cols.evaluateAll((nodes) =>
    [...new Set(nodes.map((n) => n.getAttribute("data-col")))],
  );
  expect(colNames).toEqual(["monthly_spend"]);
  // Engine all-columns ResultView must not be shown while scoped.
  await expect(outliers.locator("[data-engine-key]")).toHaveCount(0);
  await expect(outliers.getByText("outliers_per_column")).toHaveCount(0);

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
  const cols2 = await outliers
    .locator(".list-row[data-col]")
    .evaluateAll((nodes) =>
      [...new Set(nodes.map((n) => n.getAttribute("data-col")))],
    );
  // sessions may have zero outliers → message path without list rows
  if (cols2.length) {
    expect(cols2).toEqual(["sessions"]);
  } else {
    await expect(outliers.getByText(/sessions/)).toBeVisible();
  }
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
  await expect(outliers.getByText("outliers_per_column")).toBeVisible();
});
