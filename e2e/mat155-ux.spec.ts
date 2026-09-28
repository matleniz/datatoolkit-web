import { expect, test } from "@playwright/test";
import {
  clearFlowScreenshots,
  openWorkbench,
  openWorkspaceBench,
  stationsPartialWorkspace,
  waitForGridReady,
} from "./helpers";

/**
 * MAT-155 UX items 1–5, 7 + missing_values dock scoping.
 * Item 6 (label drift) was shipped in #18.
 */
test.describe("MAT-155 Studio UX", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    clearFlowScreenshots("mat155-ux");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("item 1: duplicates suggestion lets user pick subset and opens Drop duplicates", async ({
    page,
  }) => {
    await openWorkspaceBench(page, stationsPartialWorkspace(), "station_id");
    await page.getByRole("tab", { name: /Suggestions/i }).click();
    const subsetCard = page.locator("[data-sug-subset]").first();
    await expect(subsetCard).toBeVisible({ timeout: 90_000 });
    await subsetCard.getByRole("button", { name: "station_id" }).click();
    await subsetCard.getByRole("button", { name: "date" }).click();
    await subsetCard.getByRole("button", { name: /Open Drop duplicates/ }).click();
    const editor = page.getByLabel("Step editor");
    await expect(editor).toBeVisible();
    await expect(
      editor.getByText("Subset (identity columns)", { exact: true }),
    ).toBeVisible();
    const subsetGroup = editor.locator('[data-ed-group="subset"]');
    await expect(
      subsetGroup.getByRole("button", { name: /station_id/ }),
    ).toHaveClass(/on/);
    await expect(
      subsetGroup.getByRole("button", { name: /date/ }),
    ).toHaveClass(/on/);
  });

  test("item 3: Drop duplicates labels Subset vs Sort by and explains disabled Apply", async ({
    page,
  }) => {
    await openWorkbench(page, true);
    await waitForGridReady(page);

    await page.getByRole("button", { name: "+ Step" }).click();
    await page.getByRole("button", { name: "Drop duplicates" }).click();
    const editor = page.getByLabel("Step editor");
    await expect(editor).toBeVisible();

    await expect(
      editor.getByText("Subset (identity columns)", { exact: true }),
    ).toBeVisible();
    await expect(
      editor.getByText("Sort by (keep first/last)", { exact: true }),
    ).toBeVisible();

    // Ensure keep first/last without sort_by → Apply disabled with reason.
    await editor.getByRole("button", { name: "last", exact: true }).click();
    const sortGroup = editor.locator('[data-ed-group="sort_by"]');
    const sortOn = sortGroup.locator(".small-chip.on");
    while ((await sortOn.count()) > 0) {
      await sortOn.first().click();
    }
    await expect(editor.locator("[data-ed-apply-hint]")).toContainText(
      /sort_by|Sort by/i,
      { timeout: 15_000 },
    );
    await expect(
      editor.getByRole("button", { name: "Apply step" }).first(),
    ).toBeDisabled();

    await editor
      .getByRole("button", { name: "Sort by (keep first/last): customer_id" })
      .click();
    await expect(
      editor.getByRole("button", { name: "Apply step" }).first(),
    ).toBeEnabled({ timeout: 20_000 });
  });

  test("item 4: Ordinal from + Step seeds categories from active column", async ({
    page,
  }) => {
    await openWorkbench(page, true);
    await waitForGridReady(page);

    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "city" });
    });

    await page.getByRole("button", { name: "+ Step" }).click();
    await page.getByRole("button", { name: /^Ordinal/ }).click();
    const editor = page.getByLabel("Step editor");
    await expect(editor).toBeVisible();
    await expect(editor.locator(".order-row").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      editor.getByRole("button", { name: "Apply step" }).first(),
    ).toBeEnabled();
  });

  test("item 5: Sources result card shows merge-coloured chips when key chosen", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByLabel("Sources screen")).toBeVisible({
      timeout: 60_000,
    });
    const resultRegion = page.getByRole("region", { name: "Result schema" });
    const mergeChips = resultRegion.locator(".res-col-chip.origin-merge");
    await expect(mergeChips.first()).toBeVisible({ timeout: 30_000 });
    expect(await mergeChips.count()).toBeGreaterThan(0);
  });

  test("item 7: tool-rail Outliers accessible name does not collide with grid headers", async ({
    page,
  }) => {
    await openWorkbench(page, true);
    await waitForGridReady(page);

    // Headers must use column-scoped aria-labels (not alert text like "outliers").
    const spend = page.getByRole("button", {
      name: /monthly_spend/,
      exact: false,
    });
    await expect(spend.first()).toBeVisible();
    const label = await spend.first().getAttribute("aria-label");
    expect(label ?? "").not.toMatch(/outlier/i);

    const rail = page.getByRole("navigation", { name: "Analysis tools" });
    await expect(
      rail.getByRole("button", { name: "Outliers", exact: true }),
    ).toHaveCount(1);
  });

  test("missing values dock runs engine key with columns=selection when scoped", async ({
    page,
  }) => {
    await openWorkbench(page, true);
    await waitForGridReady(page);

    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "age" });
    });

    await page
      .getByRole("navigation", { name: "Analysis tools" })
      .getByRole("button", { name: "Missing values", exact: true })
      .click();

    const missing = page.locator('[data-tool="missing"]');
    await expect(missing).toBeVisible();
    await expect(missing.locator("[data-scope-mode]")).toHaveAttribute(
      "data-scope-mode",
      "selection",
      { timeout: 30_000 },
    );
    await expect(missing.locator('[data-engine-key="missing_values"]')).toBeVisible({
      timeout: 45_000,
    });
    await expect(missing.locator("[data-missing-cols]")).toHaveAttribute(
      "data-missing-cols",
      "age",
    );
    await expect(missing.getByText(/missing/i).first()).toBeVisible();

    await missing
      .getByRole("button", { name: "Widen analysis to all columns" })
      .click();
    await expect(missing.locator("[data-scope-mode]")).toHaveAttribute(
      "data-scope-mode",
      "all",
      { timeout: 30_000 },
    );
    await expect(missing.locator('[data-engine-key="missing_values"]')).toBeVisible({
      timeout: 45_000,
    });
  });
});
