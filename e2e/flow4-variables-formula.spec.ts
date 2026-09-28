import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkbench,
} from "./helpers";

test("Flow 4: variables + formula (create @spend_median, formula step, syntax error shown, value visible on Test view)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  clearFlowScreenshots("4-variables-formula");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Open workbench with reset
  await openWorkbench(page, true);

  // 2. Open Variables tab and create @spend_median
  await page.getByRole("tab", { name: "Variables" }).click();
  await expect(page.getByText("New variable")).toBeVisible();

  await page.getByRole("button", { name: "median", exact: true }).click();
  await page
    .getByRole("button", { name: "monthly_spend", exact: true })
    .click();
  await page.locator("#nv-name").fill("spend_median");
  await page.getByRole("button", { name: "Add variable" }).click();

  // Assert variable appears with train calculated value
  await expect(page.getByText("@spend_median")).toBeVisible({
    timeout: 15_000,
  });
  const varCard = page.locator(".var-card", { hasText: "@spend_median" });
  await expect(varCard).toBeVisible();
  const varValue = await varCard.locator(".var-value").innerText();
  expect(Number(varValue)).toBeGreaterThan(0);

  await captureFlowScreenshot(
    page,
    "4-variables-formula",
    "01-variable-created.png",
  );

  // 3. Open formula editor with @spend_median
  await varCard.getByRole("button", { name: "Use in formula" }).click();
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(page.locator(".ed-kicker")).toContainText("Custom formula");

  // 4. Test syntax error shown
  const nameInput = page.getByLabel("Step editor").getByLabel("Name");
  await nameInput.fill("spend_diff");
  const exprInput = page.getByLabel("Expression");
  await exprInput.fill("monthly_spend +");

  // Engine returns syntax error on invalid formula
  await expect(page.locator(".formula-status.err")).toBeVisible({
    timeout: 15_000,
  });
  const applyBtn = page.getByRole("button", { name: "Apply step" }).first();
  await expect(applyBtn).toBeDisabled();

  await captureFlowScreenshot(
    page,
    "4-variables-formula",
    "02-formula-syntax-error.png",
  );

  // 5. Correct formula expression
  await exprInput.fill("monthly_spend - @spend_median");

  // Verify accepted status and learned variable value
  await expect(page.locator(".formula-status.ok")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Learned on train", { exact: true })).toBeVisible();
  await expect(page.locator(".ed-learned")).toContainText("spend_median");

  // Verify live preview of added column
  await expect(page.locator(".grid-th.added", { hasText: "spend_diff" })).toBeVisible({
    timeout: 15_000,
  });

  await captureFlowScreenshot(
    page,
    "4-variables-formula",
    "03-formula-valid-preview.png",
  );

  // Apply step
  await applyBtn.click();
  await expect(
    page.locator(".pipeline-node", { hasText: "Formula" }),
  ).toBeVisible({ timeout: 15_000 });

  // 6. Switch to Test view and verify formula column and computed values
  const datasetGroup = page.getByRole("group", { name: "Dataset shown" });
  await datasetGroup.getByRole("button", { name: "Test", exact: true }).click();
  await expect(
    datasetGroup.getByRole("button", { name: "Test", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // Verify spend_diff column exists in grid on Test view
  const testColHeader = page.locator(".grid-th", { hasText: "spend_diff" });
  await expect(testColHeader).toBeVisible({ timeout: 15_000 });

  // Verify computed value in first row cell (monthly_spend 41 - 38.75 = 2.25)
  const testFirstCell = page
    .locator(".grid-row")
    .first()
    .locator(".grid-td")
    .last();
  await expect(testFirstCell).toBeVisible();
  await expect(testFirstCell).toHaveText("2.25");

  await captureFlowScreenshot(
    page,
    "4-variables-formula",
    "04-formula-test-view.png",
  );
});
