/**
 * datatoolkit-issues#73 — a result window wider than 560 px but too narrow for
 * all its view tabs must keep every view (Table included) reachable.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

import { openWorkspaceBench, parkinsonLikeWorkspace } from "./helpers";

test.use({ viewport: { width: 1440, height: 900 } });

function drift(page: Page): Locator {
  return page.locator('.dock-window[data-tool="drift"]');
}

/** Select a view by its tab, or by the select when the bar folded; return how. */
async function pick(win: Locator, id: string): Promise<"tab" | "select"> {
  const tab = win.locator(`[data-view-tab="${id}"]`);
  const viaTab = await tab.isVisible();
  if (viaTab) await tab.click();
  else await win.locator("[data-view-select]").selectOption(id);
  await expect(win.locator(".result-view")).toHaveAttribute("data-view", id);
  return viaTab ? "tab" : "select";
}

async function checkAllViews(page: Page) {
  const w = drift(page);
  const ids = await w
    .locator("[data-view-select] option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(ids.length).toBeGreaterThanOrEqual(8);
  expect(ids).toContain("table");
  for (const id of ids) await pick(w, id);

  // Tabs shown means they all fit; otherwise the select must be on screen.
  const bar = w.locator(".result-viewbar");
  if (await w.locator(".result-tabs").isVisible()) {
    const clipped = await w
      .locator(".result-tabs")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
  } else {
    await expect(w.locator("[data-view-select]")).toBeVisible();
  }
  await expect(bar).toBeVisible();
}

test("every view incl. Table is reachable in default and maximized windows (#73)", async ({
  page,
}) => {
  await openWorkspaceBench(page, parkinsonLikeWorkspace(), "Index");
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "OPEN_TOOL", id: "drift" });
  });
  await expect(
    drift(page).locator(".result-figure .js-plotly-plot").first(),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".dock-window:has-text('Loading…')")).toHaveCount(0, {
    timeout: 60_000,
  });

  await checkAllViews(page);

  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "SET_MAXIMIZED", id: "drift" });
  });
  await expect(drift(page).locator(".result-view")).toBeVisible();
  await checkAllViews(page);
});
