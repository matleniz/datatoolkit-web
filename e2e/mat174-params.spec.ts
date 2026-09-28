import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkspaceBench,
  titanicWorkspace,
  waitForGridReady,
} from "./helpers";

async function openToolOnColumn(
  page: import("@playwright/test").Page,
  tool: "dist" | "outliers",
  col: string,
) {
  await page.evaluate(
    ({ tool: t, col: c }) => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: c });
      d({ type: "OPEN_TOOL", id: t });
    },
    { tool, col },
  );
  const win = page.locator(`[data-tool="${tool}"]`);
  await expect(win).toBeVisible();
  return win;
}

test("MAT-174: dock Parameters — bins, contamination, per-column defaults", async ({
  page,
}) => {
  test.setTimeout(240_000);
  clearFlowScreenshots("mat174-params");
  await page.setViewportSize({ width: 1440, height: 900 });

  await openWorkspaceBench(page, titanicWorkspace(), "Age");

  // --- Distribution: changing bins changes the histogram table ---
  const dist = await openToolOnColumn(page, "dist", "Age");
  await expect(
    dist.locator('[data-engine-key="column_distribution"]'),
  ).toBeVisible({ timeout: 60_000 });
  await expect(dist.locator('[data-dock-params="column_distribution"]')).toBeVisible();

  const histTable = dist.locator(".result-table-block", {
    hasText: "histograms",
  });
  await expect(histTable).toBeVisible({ timeout: 30_000 });

  const binsParam = dist.locator('[data-dock-param="bins"]');
  await expect(binsParam).toBeVisible();
  // Force an explicit bin count (leave "auto").
  await binsParam.getByRole("button", { name: /auto/i }).click();
  await binsParam.locator('input[aria-label="Bins"]').fill("5");
  await expect
    .poll(async () => histTable.locator("tbody tr").count(), {
      timeout: 30_000,
    })
    .toBe(5);
  await expect(dist.locator("[data-dist-bins]")).toHaveAttribute(
    "data-dist-bins",
    "5",
  );

  await binsParam.locator('input[aria-label="Bins"]').fill("12");
  await expect
    .poll(async () => histTable.locator("tbody tr").count(), {
      timeout: 30_000,
    })
    .toBe(12);
  await expect(dist.locator("[data-dist-bins]")).toHaveAttribute(
    "data-dist-bins",
    "12",
  );

  await waitForGridReady(page);
  await captureFlowScreenshot(page, "mat174-params", "01-dist-bins.png");

  // --- Per-column suggested defaults differ (small-int vs continuous) ---
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "TOGGLE_TOOL", id: "dist" });
  });

  const distPclass = await openToolOnColumn(page, "dist", "Pclass");
  await expect(
    distPclass.locator('[data-engine-key="column_distribution"]'),
  ).toBeVisible({ timeout: 60_000 });
  // Wait until Reset/seed applied a numeric bins suggestion (not blank).
  const pclassBins = distPclass.locator('[data-dock-param="bins"] input');
  await expect
    .poll(async () => {
      const v = await pclassBins.inputValue();
      return v === "" ? "auto" : v;
    }, { timeout: 30_000 })
    .not.toBe("");
  // Reset to force suggested_params overlay.
  await distPclass.locator("[data-dock-params-reset]").click();
  await expect
    .poll(async () => pclassBins.inputValue(), { timeout: 15_000 })
    .not.toBe("");
  const pclassBinsVal = Number(await pclassBins.inputValue());
  expect(pclassBinsVal).toBeGreaterThanOrEqual(2);

  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "TOGGLE_TOOL", id: "dist" });
  });
  const distFare = await openToolOnColumn(page, "dist", "Fare");
  await expect(
    distFare.locator('[data-engine-key="column_distribution"]'),
  ).toBeVisible({ timeout: 60_000 });
  await distFare.locator("[data-dock-params-reset]").click();
  const fareBins = distFare.locator('[data-dock-param="bins"] input');
  await expect
    .poll(async () => fareBins.inputValue(), { timeout: 15_000 })
    .not.toBe("");
  const fareBinsVal = Number(await fareBins.inputValue());
  expect(fareBinsVal).toBeGreaterThanOrEqual(2);
  expect(fareBinsVal).not.toBe(pclassBinsVal);

  await waitForGridReady(page);
  await captureFlowScreenshot(
    page,
    "mat174-params",
    "02-per-column-defaults.png",
  );

  // --- Outliers: contamination changes flagged count ---
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "TOGGLE_TOOL", id: "dist" });
  });
  const outliers = await openToolOnColumn(page, "outliers", "Age");
  await expect(
    outliers.locator('[data-engine-key="outliers"]'),
  ).toBeVisible({ timeout: 60_000 });
  await expect(outliers.locator('[data-dock-params="outliers"]')).toBeVisible();

  const flaggedMetric = outliers.locator(".result-metric", {
    hasText: "n_rows_flagged",
  });
  await expect(flaggedMetric).toBeVisible({ timeout: 30_000 });
  const readFlagged = async () => {
    const text = await flaggedMetric.locator(".mono").innerText();
    return Number(text);
  };
  const low = await readFlagged();

  const contam = outliers.locator('[data-dock-param="contamination"] input');
  await contam.fill("0.2");
  await expect
    .poll(async () => readFlagged(), { timeout: 30_000 })
    .toBeGreaterThan(low);
  await expect(outliers.locator("[data-outliers-contamination]")).toHaveAttribute(
    "data-outliers-contamination",
    "0.2",
  );

  await waitForGridReady(page);
  await captureFlowScreenshot(
    page,
    "mat174-params",
    "03-outliers-contamination.png",
  );
});
