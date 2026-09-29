import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  churnWorkspace,
  clearFlowScreenshots,
  openWorkspaceBench,
  waitForGridReady,
} from "./helpers";

test("Flow 4: formula with a saved workspace @variable (@spend_median, formula step, syntax error shown, value visible on Test view)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  clearFlowScreenshots("4-variables-formula");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Open a workspace that already carries @spend_median (MAT-231: the
  // Variables UI is gone, but stored variables must still load and replay).
  await openWorkspaceBench(
    page,
    {
      ...churnWorkspace(),
      variables: [
        { name: "spend_median", stat: "median", column: "monthly_spend" },
      ],
    },
    "monthly_spend",
  );

  // 2. No Variables / Recipe tabs: the left panel is Suggestions only
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByText("New variable")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Suggestions" })).toBeVisible();

  await waitForGridReady(page);
  await captureFlowScreenshot(
    page,
    "4-variables-formula",
    "01-workspace-with-variable.png",
  );

  // 3. Open the formula editor from the column menu; the stored variable is
  // offered next to the palette
  await page
    .getByRole("button", { name: "monthly_spend, number" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /Use in formula/ }).click();
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(page.locator(".ed-kicker")).toContainText("Custom formula");
  await expect(
    page.getByLabel("Step editor").getByText("@spend_median"),
  ).toBeVisible();

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

  await waitForGridReady(page);
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

  await waitForGridReady(page);
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

  await waitForGridReady(page);
  await captureFlowScreenshot(
    page,
    "4-variables-formula",
    "04-formula-test-view.png",
  );
});
