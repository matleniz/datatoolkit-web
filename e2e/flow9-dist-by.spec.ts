import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openDetails,
  openWorkspaceBench,
  titanicWorkspace,
  titanicYFileWorkspace,
  waitForGridReady,
} from "./helpers";

async function openDistBy(
  page: import("@playwright/test").Page,
  col: string,
  by: string,
) {
  await page.evaluate(
    ({ col: c, by: b }) => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: c });
      d({ type: "SET_DIST_BY", by: b });
      d({ type: "OPEN_TOOL", id: "dist" });
    },
    { col, by },
  );
  const dist = page.locator('[data-tool="dist"]');
  await expect(dist).toBeVisible();
  await expect(dist.locator("[data-dist-col]")).toHaveAttribute(
    "data-dist-col",
    col,
    { timeout: 30_000 },
  );
  await expect(dist.locator("[data-dist-by]")).toHaveAttribute(
    "data-dist-by",
    by,
    { timeout: 30_000 },
  );
  await expect(
    dist.locator('[data-engine-key="column_distribution"]'),
  ).toBeVisible({ timeout: 60_000 });
  return dist;
}

test("MAT-147: Distribution by target / by column (Titanic) + outliers scoped", async ({
  page,
}) => {
  test.setTimeout(180_000);
  clearFlowScreenshots("9-dist-by");
  await page.setViewportSize({ width: 1440, height: 900 });

  await openWorkspaceBench(page, titanicWorkspace(), "Age");

  // Age by Survived (numeric × categorical target)
  let dist = await openDistBy(page, "Age", "Survived");
  await expect(dist.getByText(/split by Survived/)).toBeVisible();
  await expect(dist.locator(".result-figure").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(dist.getByLabel("Split by")).toHaveValue("Survived");
  await waitForGridReady(page);
  await captureFlowScreenshot(page, "9-dist-by", "01-age-by-survived.png");

  // Sex by Survived (categorical × categorical)
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "TOGGLE_TOOL", id: "dist" });
  });
  dist = await openDistBy(page, "Sex", "Survived");
  // Tables live in the collapsed Details drawer since MAT-235.
  await openDetails(dist);
  await expect(dist.getByText("value_counts")).toBeVisible({
    timeout: 30_000,
  });
  await waitForGridReady(page);
  await captureFlowScreenshot(page, "9-dist-by", "02-sex-by-survived.png");

  // Fare by Pclass (numeric × categorical non-target)
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "TOGGLE_TOOL", id: "dist" });
  });
  dist = await openDistBy(page, "Fare", "Pclass");
  await expect(dist.getByText(/split by Pclass/)).toBeVisible();
  await expect(dist.locator(".result-figure").first()).toBeVisible({
    timeout: 30_000,
  });
  await waitForGridReady(page);
  await captureFlowScreenshot(page, "9-dist-by", "03-fare-by-pclass.png");

  // Age vs Fare scatter (numeric × numeric)
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "TOGGLE_TOOL", id: "dist" });
  });
  dist = await openDistBy(page, "Age", "Fare");
  await openDetails(dist);
  await expect(dist.locator(".result-metric", { hasText: "pearson" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(dist.locator(".result-metric", { hasText: "spearman" })).toBeVisible();
  await expect(dist.getByText("vs_by")).toBeVisible();
  await expect(dist.getByText("Age vs Fare")).toBeVisible();
  await waitForGridReady(page);
  await captureFlowScreenshot(page, "9-dist-by", "04-age-vs-fare.png");

  // Outliers scoped to Age via engine columns=
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "TOGGLE_TOOL", id: "dist" });
    d({ type: "CLEAR_SELECTION" });
    d({ type: "PICK_COL", name: "Age" });
    d({ type: "OPEN_TOOL", id: "outliers" });
  });
  const outliers = page.locator('[data-tool="outliers"]');
  await expect(outliers.locator('[data-engine-key="outliers"]')).toBeVisible({
    timeout: 60_000,
  });
  await expect(outliers.locator("[data-outliers-col]")).toHaveAttribute(
    "data-outliers-col",
    "Age",
  );
  await openDetails(outliers);
  await expect(outliers.getByText("outliers_per_column")).toBeVisible();
  const table = outliers.locator(".result-table-block", {
    hasText: "outliers_per_column",
  });
  await expect(table.getByText("Age")).toBeVisible();
  await expect(table.getByText("Fare")).toHaveCount(0);
  await waitForGridReady(page);
  await captureFlowScreenshot(page, "9-dist-by", "05-outliers-age.png");

  // Inspector "Distribution by…" preselects target
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "TOGGLE_TOOL", id: "outliers" });
    d({ type: "CLEAR_SELECTION" });
    d({ type: "PICK_COL", name: "Age" });
  });
  await page.getByRole("button", { name: "Distribution by…" }).click();
  dist = page.locator('[data-tool="dist"]');
  await expect(dist.locator("[data-dist-by]")).toHaveAttribute(
    "data-dist-by",
    "Survived",
    { timeout: 30_000 },
  );
  await expect(
    dist.locator('[data-engine-key="column_distribution"]'),
  ).toBeVisible({ timeout: 60_000 });
});

test("MAT-147: Distribution by target from y file", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await openWorkspaceBench(page, titanicYFileWorkspace(), "Age");

  // y-file join exposes the label as `target` (Studio convention).
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.__DTK_STATE__?.()?.targetColumn ?? null),
      { timeout: 15_000 },
    )
    .toBe("target");

  const dist = await openDistBy(page, "Age", "target");
  await expect(dist.getByText(/split by target/)).toBeVisible();
  await expect(
    dist.locator('[data-engine-key="column_distribution"]'),
  ).toBeVisible();
  await expect(dist.locator(".result-figure").first()).toBeVisible({
    timeout: 30_000,
  });
});
