import { expect, test } from "@playwright/test";
import {
  clearFlowScreenshots,
  openWorkbench,
  waitForGridReady,
} from "./helpers";

test("Flow 8: MAT-150 exposed ops (Section 6 ffill, Section 9 bin, Section 11 select_k_best, feature_selection dock, ordinal in context menu)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  clearFlowScreenshots("8-expose-ops");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Open workbench
  await openWorkbench(page, true);
  await waitForGridReady(page);

  // 2. Right-click text column 'city' and verify Ordinal... is in context menu
  const cityHeader = page.locator(".grid-th", { hasText: "city" }).first();
  await cityHeader.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Column menu" })).toBeVisible();
  const ordinalMenuItem = page.getByRole("menuitem", { name: /Ordinal…/ });
  await expect(ordinalMenuItem).toBeVisible();
  await ordinalMenuItem.click();

  // Verify ordinal editor opens and auto-seeds categories
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(page.locator(".order-list")).toBeVisible();
  await expect(page.locator(".order-row").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Apply step" }).first()).toBeEnabled();

  // Return to picker
  await page.getByRole("button", { name: "← All transforms" }).click();
  const picker = page.getByLabel("Step editor");
  await expect(picker).toBeVisible();

  // Clean stage ops
  await expect(picker.getByRole("button", { name: "Forward fill" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Impute (KNN)" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Impute (iterative)" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Drop rows with missing target" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Filter rows" })).toBeVisible();

  // Transform stage ops
  await expect(picker.getByRole("button", { name: "Bin column" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Interactions" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Group aggregate" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Cyclical encoding" })).toBeVisible();

  // Select stage ops
  await expect(picker.getByRole("button", { name: "Drop low variance" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Drop correlated" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Select k best" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Select from model" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "PCA" })).toBeVisible();

  // Check drop_missing_target does not say "Not fitted"
  await picker.getByRole("button", { name: "Drop rows with missing target" }).click();
  await expect(page.getByText("Not fitted: nothing is learned on train")).toHaveCount(0);

  // Return to picker
  await page.getByRole("button", { name: "← All transforms" }).click();

  // 4. Course Section 6 op: Apply Forward Fill (ffill)
  await picker.getByRole("button", { name: "Forward fill" }).click();
  // Select sort_by column (e.g. customer_id)
  await page.locator(".ed-field").filter({ hasText: "Sort By" }).getByRole("button", { name: "customer_id" }).click();
  // Select column to fill (e.g. age)
  await page.locator(".ed-field").filter({ hasText: "Columns" }).getByRole("button", { name: "age" }).click();
  await expect(page.getByRole("button", { name: "Apply step" }).first()).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("button", { name: "Apply step" }).first().click();

  const ffillNode = page.locator(".pipeline-node", { hasText: "Forward fill" }).first();
  await expect(ffillNode).toBeVisible({ timeout: 20_000 });

  // 4b. Filter rows: apply numeric filter and check row count in pipeline node
  await page.getByRole("button", { name: "+ Step" }).click();
  await picker.getByRole("button", { name: "Filter rows" }).click();
  await expect(page.getByLabel("Condition 1 column")).toBeVisible({ timeout: 10_000 });
  await page.getByLabel("Condition 1 column").selectOption("sessions");
  await page.getByLabel("Condition 1 operator").selectOption("gt");
  await page.getByLabel("Condition 1 value").fill("5");
  await expect(page.getByRole("button", { name: "Apply step" }).first()).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("button", { name: "Apply step" }).first().click();

  const filterNode = page.locator(".pipeline-node", { hasText: "Filter rows" }).first();
  await expect(filterNode).toBeVisible({ timeout: 20_000 });
  await expect(filterNode.locator(".pipeline-shape")).toContainText("13 × 10");
  await expect(filterNode.locator(".pipeline-delta")).toContainText("−7r");

  // 5. Course Section 9 op: Apply Binning (bin)
  await page.getByRole("button", { name: "+ Step" }).click();
  await picker.getByRole("button", { name: "Bin column" }).click();
  // Select column: age
  await page.locator(".ed-field").filter({ hasText: "Column" }).getByRole("button", { name: "age" }).click();
  await expect(page.getByRole("button", { name: "Apply step" }).first()).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("button", { name: "Apply step" }).first().click();

  const binNode = page.locator(".pipeline-node", { hasText: "Bin column" }).first();
  await expect(binNode).toBeVisible({ timeout: 20_000 });

  // 6. Course Section 11 op: Apply Feature Selection (select_k_best or pca)
  await page.getByRole("button", { name: "+ Step" }).click();
  await picker.getByRole("button", { name: "Select k best" }).click();
  // Verify target is already prefilled or select churn
  await expect(page.getByRole("button", { name: "Apply step" }).first()).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("button", { name: "Apply step" }).first().click();

  const selectNode = page.locator(".pipeline-node", { hasText: "Select k best" }).first();
  await expect(selectNode).toBeVisible({ timeout: 20_000 });
  // Verify it has the fitted badge
  await expect(selectNode.locator(".pipeline-badge")).toContainText("fit");

  // 7. Open Feature Selection dock window from tool rail
  await page.getByRole("button", { name: "Feature selection", exact: true }).click();
  const fsWindow = page.locator('[data-tool="feature_selection"]');
  await expect(fsWindow).toBeVisible();

  // Wait for real content (table/result view)
  await expect(fsWindow.locator(".result-view, [data-owner]")).toBeVisible({ timeout: 45_000 });
  await expect(fsWindow.locator(".engine-error")).toHaveCount(0);
});
