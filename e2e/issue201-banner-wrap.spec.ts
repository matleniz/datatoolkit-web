import { expect, test, type Locator } from "@playwright/test";

import { openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#201 — banner rows of the grid column must wrap instead of
 * pushing their last buttons out of a narrow centre column.
 */
test.use({ viewport: { width: 1280, height: 720 } });

/** The element's right edge is inside its container's. */
async function insideRight(el: Locator, container: Locator) {
  const [e, c] = await Promise.all([el.boundingBox(), container.boundingBox()]);
  expect(e).not.toBeNull();
  expect(c).not.toBeNull();
  expect(e!.x + e!.width).toBeLessThanOrEqual(c!.x + c!.width + 0.5);
}

test("issue 201: the view filter form keeps Cancel inside the grid column", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  await waitForGridReady(page);

  await page.getByRole("button", { name: "age, number" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Filter/ }).click();
  const banner = page.locator(".view-banner");
  await expect(banner).toBeVisible();
  await insideRight(banner.getByRole("button", { name: "Cancel" }), banner);
  await insideRight(banner.getByRole("button", { name: "Apply to view" }), banner);
});

test("issue 201: the live-preview bar keeps Apply step reachable with the agent panel open", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  await waitForGridReady(page);

  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({
      type: "OPEN_EDITOR",
      op: "formula",
      params: { name: "age_plus_one", expr: "age + 1" },
      target: "both",
    }),
  );
  const banner = page.locator(".preview-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await insideRight(banner.getByRole("button", { name: "Apply step" }), banner);
  await insideRight(banner.getByRole("button", { name: "Discard" }), banner);
});
