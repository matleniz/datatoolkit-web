/**
 * datatoolkit-issues#81 — view-only grid filter / sort: no step, no identity
 * change; "Make it a step" adds a filter_rows step with the same params.
 */
import { expect, test, type Page } from "@playwright/test";

import { openWorkspaceBench, titanicWorkspace } from "./helpers";

test.use({ viewport: { width: 1440, height: 900 } });

async function menu(page: Page, col: string, item: string) {
  await page.locator(".grid-th", { hasText: col }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: item }).click();
}

test("#81: view-only filter + sort, then make it a step", async ({ page }) => {
  test.setTimeout(180_000);
  await openWorkspaceBench(page, titanicWorkspace(), "Age");
  const grid = page.getByLabel("Data grid");
  const identity = await grid.getAttribute("data-identity");
  const state = () =>
    page.evaluate(() => JSON.stringify(window.__DTK_STATE__?.().workspace?.steps));
  const steps0 = await state();

  await menu(page, "Age", "Filter…");
  await page.getByLabel("Filter operator").selectOption("gt");
  await page.getByLabel("Filter value").fill("60");
  await page.getByRole("button", { name: "Apply to view" }).click();
  await menu(page, "Age", "Sort descending");

  const bar = page.locator("[data-grid-view]");
  await expect(bar).toContainText("View only");
  await expect(bar).toContainText("not a step");
  await expect(bar.locator("[data-view-count]")).toHaveText(/^\d+ of 41 rows$/);
  await expect(grid.locator(".grid-row").first()).toBeVisible();
  await expect
    .poll(async () => {
      const t = await page
        .locator(".grid-row")
        .first()
        .locator('[title^="Age = "]')
        .first()
        .getAttribute("title");
      return Number(t?.match(/Age = ([\d.]+)/)?.[1] ?? 0);
    })
    .toBe(70);

  expect(await grid.getAttribute("data-identity")).toBe(identity);
  expect(await state()).toBe(steps0);

  await bar.getByRole("button", { name: "Make it a step" }).click();
  await expect(bar).toHaveCount(1); // sort remains
  await expect(bar.locator("[data-view-count]")).toHaveCount(0);
  const steps1 = JSON.parse((await state()) ?? "[]");
  expect(steps1).toHaveLength(1);
  expect(steps1[0].op).toBe("filter_rows");
  expect(steps1[0].params).toEqual({
    conditions: [{ column: "Age", op: "gt", value: 60 }],
    combine: "and",
  });
});
