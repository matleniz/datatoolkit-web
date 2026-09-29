import { expect, test } from "@playwright/test";
import {
  chipotlePricesWorkspace,
  clearFlowScreenshots,
  highMissingWorkspace,
  messySurveyWorkspace,
  openWorkspaceBench,
  waitForGridReady,
} from "./helpers";

/**
 * MAT-160 front wiring: to_numeric (currency), standardize_text.unify_separators,
 * drop_high_missing + missing_values metrics / suggestions.
 */
test.describe("MAT-160 cleaning ops", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    clearFlowScreenshots("mat160-cleaning");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("chipotle-like: Parse as number then formula quantity*item_price", async ({
    page,
  }) => {
    await openWorkspaceBench(page, chipotlePricesWorkspace(), "item_price");
    await waitForGridReady(page);

    const priceHeader = page.locator(".grid-th", { hasText: "item_price" }).first();
    await priceHeader.click();
    await expect(page.getByLabel("Inspector")).toContainText(/currency as text/i, {
      timeout: 45_000,
    });

    await priceHeader.click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Column menu" });
    await expect(menu).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /Parse as number/ }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: /Parse as number/ }).click();

    const editor = page.getByLabel("Step editor");
    await expect(editor).toBeVisible();
    await expect(editor.locator(".ed-title")).toContainText(/Parse numeric|to_numeric/i);
    // Prefill from currency_as_text: decimal "." selected.
    await expect(
      editor.locator(".ed-field").filter({ hasText: "Decimal" }).getByRole("button", {
        name: ".",
        exact: true,
      }),
    ).toHaveClass(/on/);
    await expect(
      editor.getByRole("button", { name: "Apply step" }).first(),
    ).toBeEnabled({ timeout: 20_000 });
    await editor.getByRole("button", { name: "Apply step" }).first().click();

    await expect(
      page.locator(".pipeline-node", { hasText: /Parse numeric|to_numeric/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Formula quantity * item_price
    await page.getByRole("button", { name: "+ Step" }).click();
    await page.getByLabel("Step editor").getByRole("button", { name: "Formula", exact: true }).click();
    await editor.getByLabel("Name").fill("line_total");
    await editor.getByLabel("Expression").fill("quantity * item_price");
    await expect(editor.locator(".formula-status.ok")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      editor.getByRole("button", { name: "Apply step" }).first(),
    ).toBeEnabled({ timeout: 15_000 });
    await editor.getByRole("button", { name: "Apply step" }).first().click();

    await expect(
      page.locator(".pipeline-node", { hasText: "Formula" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator(".grid-th", { hasText: "line_total" }),
    ).toBeVisible({ timeout: 15_000 });
    // First row: 1 * 2.39
    const firstRow = page.locator(".grid-row").first();
    await expect(firstRow).toContainText("2.39");
  });

  test("messy survey: unify_separators collapses site-a / site_a / Site A", async ({
    page,
  }) => {
    await openWorkspaceBench(page, messySurveyWorkspace(), "site");
    await waitForGridReady(page);

    const siteHeader = page.locator(".grid-th", { hasText: "site" }).first();
    await siteHeader.click({ button: "right" });
    await page.getByRole("menuitem", { name: /Standardize text/ }).click();

    const editor = page.getByLabel("Step editor");
    await expect(editor).toBeVisible();
    // Wait for schema-driven fields (defaults load async and would overwrite early clicks).
    const unifyField = editor
      .locator(".ed-field")
      .filter({ hasText: /Unify Separators/i });
    const lowerField = editor.locator(".ed-field").filter({ hasText: "Lower" });
    await expect(unifyField).toBeVisible({ timeout: 15_000 });
    await expect(lowerField).toBeVisible();
    // Studio defaults lower=yes; unify_separators stays no until enabled.
    await expect(lowerField.getByRole("button", { name: "yes" })).toHaveClass(/on/);
    await expect(unifyField.getByRole("button", { name: "no" })).toHaveClass(/on/);
    await expect(
      editor.getByRole("button", { name: "Apply step" }).first(),
    ).toBeEnabled({ timeout: 20_000 });

    await unifyField.getByRole("button", { name: "yes" }).click();
    await expect(unifyField.getByRole("button", { name: "yes" })).toHaveClass(/on/);
    await expect(lowerField.getByRole("button", { name: "yes" })).toHaveClass(/on/);

    await expect(
      editor.getByRole("button", { name: "Apply step" }).first(),
    ).toBeEnabled({ timeout: 20_000 });
    await editor.getByRole("button", { name: "Apply step" }).first().click();

    await expect(
      page.locator(".pipeline-node", { hasText: /Standardize text/ }),
    ).toBeVisible({ timeout: 20_000 });

    // Collapsed values only (case-sensitive exact cells).
    await expect(
      page.locator(".grid-td").filter({ hasText: /^site a$/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(".grid-td").filter({ hasText: /^site-a$/ }),
    ).toHaveCount(0);
    await expect(
      page.locator(".grid-td").filter({ hasText: /^site_a$/ }),
    ).toHaveCount(0);
    await expect(
      page.locator(".grid-td").filter({ hasText: /^Site A$/ }),
    ).toHaveCount(0);

    // Inspector distinct collapses to 3 sites.
    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "site" });
    });
    const insp = page.getByLabel("Inspector");
    await expect(insp).toBeVisible();
    await expect(insp.locator(".insp-stat", { hasText: "distinct" })).toContainText(
      "3",
      { timeout: 30_000 },
    );
  });

  test("high-missing: metrics, suggestion, drop on train and test", async ({
    page,
  }) => {
    await openWorkspaceBench(page, highMissingWorkspace(), "sparse_col");
    await waitForGridReady(page);

    // Missing values dock shows overall cell metrics.
    await page
      .getByRole("navigation", { name: "Analysis tools" })
      .getByRole("button", { name: "Missing values", exact: true })
      .click();
    const missWin = page.locator('[data-tool="missing"]');
    await expect(missWin).toBeVisible();
    await expect(missWin.locator(".result-view")).toBeVisible({ timeout: 45_000 });
    await expect(missWin.locator(".result-metrics")).toContainText("n_missing_cells");
    await expect(missWin.locator(".result-metrics")).toContainText(
      "pct_missing_cells",
    );

    // Suggestions panel: drop_high_missing card opens editor.
    const dropCard = page.locator(
      '.sug-card[data-sug-id*="suggested_steps"], .sug-card[data-sug-id*="missing_values:suggested_steps"]',
    ).first();
    await expect(dropCard).toBeVisible({ timeout: 90_000 });
    await expect(dropCard).toContainText(/drop|missing/i);
    await dropCard.getByRole("button", { name: /Open in editor/ }).click();

    const editor = page.getByLabel("Step editor");
    await expect(editor).toBeVisible();
    await expect(editor.locator(".ed-title")).toContainText(
      /Drop high-missing|drop_high_missing/i,
    );
    // Target from suggested_steps / workspace (aria-label is "Target: target").
    await expect(
      editor.getByRole("button", { name: /Target: target/i }),
    ).toHaveClass(/on/);

    await expect(
      editor.getByRole("button", { name: "Apply step" }).first(),
    ).toBeEnabled({ timeout: 20_000 });
    await editor.getByRole("button", { name: "Apply step" }).first().click();

    await expect(
      page.locator(".pipeline-node", { hasText: /Drop high-missing/i }),
    ).toBeVisible({ timeout: 20_000 });

    // sparse_col gone on train.
    await expect(page.locator(".grid-th", { hasText: "sparse_col" })).toHaveCount(0);
    await expect(page.locator(".grid-th", { hasText: "keep_col" })).toBeVisible();

    // Same columns dropped on test.
    const datasetGroup = page.getByRole("group", { name: "Dataset shown" });
    await datasetGroup.getByRole("button", { name: "Test", exact: true }).click();
    await expect(
      datasetGroup.getByRole("button", { name: "Test", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitForGridReady(page);
    await expect(page.locator(".grid-th", { hasText: "sparse_col" })).toHaveCount(0);
    await expect(page.locator(".grid-th", { hasText: "keep_col" })).toBeVisible();
  });

  test("+ Step picker lists to_numeric and drop_high_missing under Clean", async ({
    page,
  }) => {
    await openWorkspaceBench(page, chipotlePricesWorkspace(), "item_price");
    await page.getByRole("button", { name: "+ Step" }).click();
    const picker = page.getByLabel("Step editor");
    await expect(picker).toBeVisible();
    await expect(
      picker.getByRole("button", { name: /Parse numeric text/i }),
    ).toBeVisible();
    await expect(
      picker.getByRole("button", { name: /Drop high-missing columns/i }),
    ).toBeVisible();
  });
});
