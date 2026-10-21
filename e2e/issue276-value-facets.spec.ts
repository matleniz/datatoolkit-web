/**
 * datatoolkit-issues#276 — tick-box value facets feed the grid VIEW filter
 * only: no step, no identity change; "Make it a step" still works.
 */
import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./a11y";
import { openWorkspaceBench, titanicWorkspace } from "./helpers";

test.use({ viewport: { width: 1440, height: 900 } });

test("#276: ticked values filter the view, then make it a step", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openWorkspaceBench(page, titanicWorkspace(), "Sex");
  const grid = page.getByLabel("Data grid");
  const identity = await grid.getAttribute("data-identity");
  const state = () =>
    page.evaluate(() => JSON.stringify(window.__DTK_STATE__?.().workspace?.steps));
  const steps0 = await state();

  await page.locator(".grid-th", { hasText: "Sex" }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Filter…" }).click();
  const facets = page.getByRole("group", { name: "Values of Sex" });
  await expect(facets.getByRole("checkbox")).not.toHaveCount(0);
  await expect(facets).toContainText(/\d/); // counts next to the values
  await facets.getByRole("checkbox").nth(0).check();
  await expectNoA11yViolations(page, "value facets (#276)");
  await page.getByRole("button", { name: "Apply to view" }).click();

  const bar = page.locator("[data-grid-view]");
  await expect(bar).toContainText("is one of");
  await expect(bar.locator("[data-view-count]")).toHaveText("24 of 41 rows");
  expect(await grid.getAttribute("data-identity")).toBe(identity);
  expect(await state()).toBe(steps0);

  await bar.getByRole("button", { name: "Make it a step" }).click();
  const steps1 = JSON.parse((await state()) ?? "[]");
  expect(steps1).toHaveLength(1);
  expect(steps1[0].op).toBe("filter_rows");
  expect(steps1[0].params.conditions).toHaveLength(1);
  expect(steps1[0].params.conditions[0]).toMatchObject({
    column: "Sex",
    op: "isin",
  });
  expect(steps1[0].params.conditions[0].value).toEqual(["female"]);
});

test("#276: the list says when the column has more values than top_values", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openWorkspaceBench(page, titanicWorkspace(), "Name");
  await page.locator(".grid-th", { hasText: "Name" }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Filter…" }).click();
  await expect(page.locator("[data-facets-truncated]")).toContainText(
    /most frequent of \d+ distinct values/,
  );
});
