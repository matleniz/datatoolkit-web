import { expect, test } from "@playwright/test";

import {
  clearFlowScreenshots,
  captureFlowScreenshot,
  openWorkbench,
  waitForGridReady,
} from "./helpers";

/**
 * datatoolkit-issues#316 — the expected_schema step: a dedicated rule editor
 * (params.columns = list of rule objects), the violations table under the live
 * preview, and the on_violation=error 422 shown as the step error.
 */
test("issue 316: expected_schema rules edit, violations table, error mode", async ({ page }) => {
  test.setTimeout(180_000);
  clearFlowScreenshots("316-expected-schema");
  await openWorkbench(page, true);
  await waitForGridReady(page);

  const steps = () =>
    page.evaluate(() => window.__DTK_STATE__?.()?.workspace?.steps ?? []);

  await page.getByRole("navigation", { name: "Analysis tools" })
    .getByRole("button", { name: "Transform", exact: true }).click();
  const editor = page.getByLabel("Step editor");
  await editor.getByRole("button", { name: "Expected schema" }).click();
  await expect(editor.getByText("Column rules")).toBeVisible({ timeout: 15_000 });
  // The engine constant is not an input.
  await expect(editor.getByText("Schema Version")).toHaveCount(0);

  // Rules for two columns of the churn CSV.
  await editor.getByRole("button", { name: "Add rule: age", exact: true }).click();
  await editor.getByRole("button", { name: "Add rule: plan", exact: true }).click();
  await expect(editor.getByLabel("Rule 1: column name")).toHaveValue("age");
  await editor.getByLabel("age: max", { exact: true }).fill("40");
  await editor.getByLabel("age: nullable").uncheck();
  await editor.getByLabel("plan: allowed values").fill("pro, basic");

  const table = editor.getByRole("table", { name: "Schema violations" });
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(table.locator('[data-violation-check="range"]').first()).toContainText("age");
  await expect(table.locator('[data-violation-check="allowed"]').first()).toContainText("plan");
  await expect(table.locator("tr", { hasText: "train" }).first()).toBeVisible();
  await expect(editor.locator(".ed-learned")).toContainText("rows checked");
  await expect(page.getByText("Computing preview…")).toHaveCount(0);
  await expect(table).toBeVisible();
  await table.scrollIntoViewIfNeeded();
  await captureFlowScreenshot(page, "316-expected-schema", "01-violations.png");
  // The table alone: a full-page capture does not scroll the editor panel.
  await editor.locator(".violations").scrollIntoViewIfNeeded();
  const box = await editor.locator(".violations").boundingBox();
  await page.screenshot({
    path: "e2e/screenshots/316-expected-schema/01b-violations-table.png",
    clip: box ?? undefined,
  });


  // on_violation=error: the preview is a 422 quoting the violations; Apply is off.
  await editor.getByRole("button", { name: "error", exact: true }).click();
  await expect(editor.getByText(/expected schema violated/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Apply step" }).first()).toBeDisabled();
  await captureFlowScreenshot(page, "316-expected-schema", "02-error-mode.png");

  // Back to report and relax the rules: fewer findings, then Apply.
  await editor.getByRole("button", { name: "report", exact: true }).click();
  await expect(table).toBeVisible({ timeout: 30_000 });
  await editor.getByLabel("age: max", { exact: true }).fill("");
  await expect(table.locator('[data-violation-check="range"]')).toHaveCount(0, { timeout: 30_000 });

  const apply = page.getByRole("button", { name: "Apply step" }).first();
  await expect(apply).toBeEnabled({ timeout: 30_000 });
  await apply.click();
  await expect(editor).toHaveCount(0, { timeout: 30_000 });
  await waitForGridReady(page);

  const applied = await steps();
  expect(applied).toHaveLength(1);
  expect(applied[0]).toMatchObject({
    op: "expected_schema",
    params: {
      on_violation: "report",
      columns: [
        { name: "age", dtype: "numeric", nullable: false },
        { name: "plan", allowed: ["pro", "basic"] },
      ],
    },
  });
});
