import { expect, test } from "@playwright/test";

import { openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#277 — "Merge" on a Value groups row opens a replace_values
 * step (variants -> canonical form) with the live preview; nothing changes
 * until Apply, and the step is undoable.
 */
test("issue 277: Merge on a value group opens a previewed replace_values step", async ({ page }) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  await waitForGridReady(page);

  const steps = () =>
    page.evaluate(() => window.__DTK_STATE__?.()?.workspace?.steps ?? []);

  await page.locator(".grid-th", { hasText: "city" }).first().click();
  const inspector = page.getByLabel("Inspector");
  await inspector.getByRole("button", { name: "Merge paris", exact: true }).click();

  const editor = page.getByLabel("Step editor");
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("city: old value 1")).toHaveValue("Paris");
  await expect(editor.getByLabel("city: new value 1")).toHaveValue("paris");
  await expect(editor.getByLabel("city: old value 2")).toHaveValue("PARIS ");
  await expect(page.getByText("Live preview")).toBeVisible({ timeout: 20_000 });
  // Nothing changed yet.
  expect(await steps()).toHaveLength(0);

  const apply = page.getByRole("button", { name: "Apply step" }).first();
  await expect(apply).toBeEnabled({ timeout: 30_000 });
  await apply.click();
  await expect(editor).toHaveCount(0, { timeout: 30_000 });
  await waitForGridReady(page);

  const applied = await steps();
  expect(applied).toHaveLength(1);
  expect(applied[0]).toMatchObject({
    op: "replace_values",
    params: { mapping: { city: { Paris: "paris", "PARIS ": "paris" } } },
  });

  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  await waitForGridReady(page);
  expect(await steps()).toHaveLength(0);
});
