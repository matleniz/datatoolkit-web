import { expect, test } from "@playwright/test";

import { openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#197 — the Sort rows editor used to take the whole page
 * down (`ascending` is `bool | list[bool]`, collapsed to column chips that then
 * called `.filter` on `true`).
 */
test("issue 197: Sort rows opens, applies and keeps the page alive", async ({ page }) => {
  test.setTimeout(180_000);
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));

  await openWorkbench(page, true);
  await waitForGridReady(page);

  await page.getByRole("button", { name: "+ Step" }).click();
  await page.getByRole("button", { name: "Sort rows", exact: true }).click();
  const editor = page.getByLabel("Step editor");
  await expect(editor).toBeVisible();

  await editor.getByRole("button", { name: "By: age", exact: true }).click();
  await editor.getByRole("group", { name: "Ascending" }).getByRole("button", { name: "no" }).click();
  const apply = page.getByRole("button", { name: "Apply step" }).first();
  await expect(apply).toBeEnabled({ timeout: 30_000 });
  await apply.click();
  await expect(editor).toHaveCount(0, { timeout: 30_000 });
  await waitForGridReady(page);

  const last = await page.evaluate(() => {
    const steps = window.__DTK_STATE__?.()?.workspace?.steps ?? [];
    return steps[steps.length - 1];
  });
  expect(last).toMatchObject({ op: "sort_rows", params: { by: ["age"], ascending: false } });
  expect(crashes).toEqual([]);
});
