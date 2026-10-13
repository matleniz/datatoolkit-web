import { expect, test } from "@playwright/test";

import { openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#198 — Replace values had no control for its required
 * `mapping` param (column -> {old: new}), so Apply stayed disabled.
 */
test("issue 198: Replace values builds a mapping, applies it and reopens it", async ({ page }) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  await waitForGridReady(page);

  await page.getByRole("button", { name: "+ Step" }).click();
  await page.getByRole("button", { name: "Replace values", exact: true }).click();
  const editor = page.getByLabel("Step editor");
  await expect(editor).toBeVisible();
  await expect(editor).not.toContainText("did not yield editor fields");

  const apply = page.getByRole("button", { name: "Apply step" }).first();
  await expect(apply).toBeDisabled();

  await editor.getByRole("button", { name: "Column: age", exact: true }).click();
  await editor.getByLabel("age: old value 1").fill("34");
  await editor.getByLabel("age: new value 1").fill("35");
  await editor.getByRole("button", { name: "age: add a pair" }).click();
  await editor.getByLabel("age: old value 2").fill("51");
  // New value left empty: the old one becomes missing.
  await expect(apply).toBeEnabled({ timeout: 30_000 });
  await apply.click();
  await expect(editor).toHaveCount(0, { timeout: 30_000 });
  await waitForGridReady(page);

  const last = () =>
    page.evaluate(() => {
      const steps = window.__DTK_STATE__?.()?.workspace?.steps ?? [];
      return steps[steps.length - 1];
    });
  expect(await last()).toMatchObject({
    op: "replace_values",
    params: { mapping: { age: { "34": 35, "51": null } } },
  });

  // Edit it again: the pairs come back.
  await page.getByRole("button", { name: "Edit this step" }).last().click();
  const again = page.getByLabel("Step editor");
  await expect(again.getByLabel("age: old value 1")).toHaveValue("34");
  await expect(again.getByLabel("age: new value 1")).toHaveValue("35");
  await expect(again.getByLabel("age: old value 2")).toHaveValue("51");
  await expect(again.getByLabel("age: new value 2")).toHaveValue("");
});
