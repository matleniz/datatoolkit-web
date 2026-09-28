import { expect, test, type Locator, type Page } from "@playwright/test";
import { wideAlignWorkspace } from "./helpers";

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
] as const;

/** True when the element's box is fully inside the viewport. */
async function isFullyInViewport(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return (
      r.top >= 0 &&
      r.left >= 0 &&
      r.bottom <= window.innerHeight &&
      r.right <= window.innerWidth &&
      r.height > 0
    );
  });
}

/**
 * Wheel-scroll a panel until `target` is fully in view.
 * Uses mouse.wheel (not scrollIntoView) so we prove the overflow chain works.
 */
async function wheelUntilInView(
  page: Page,
  scrollPanel: Locator,
  target: Locator,
): Promise<void> {
  const box = await scrollPanel.boundingBox();
  if (!box) throw new Error("scroll panel has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(40, box.height / 2));

  for (let i = 0; i < 60; i++) {
    if (await isFullyInViewport(target)) return;
    await page.mouse.wheel(0, 480);
  }
  throw new Error("target not reachable by wheel scroll");
}

async function openWideAlign(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.__DTK_DISPATCH__ === "function",
  );

  const ws = wideAlignWorkspace();
  await page.evaluate((workspace) => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_WORKSPACE", workspace });
    d({ type: "SET_SCREEN", screen: "align" });
    d({ type: "CLEAR_SELECTION" });
  }, ws);
  await page.waitForFunction(async () => {
    const p = window.__DTK_WORKSPACE_SAVED__;
    if (!p) return false;
    await p;
    return true;
  });

  await expect(
    page.getByRole("main").getByText("Train / test alignment"),
  ).toBeVisible();
  // Wait until the wide report is loaded (last mismatch row present).
  await expect(page.locator(".align-table-row")).toHaveCount(65, {
    timeout: 60_000,
  });
  const lastRow = page.locator(".align-table-row").last();
  await expect(lastRow).toContainText("extra in test");
  await expect(lastRow.getByText("col_extra_in_test", { exact: true })).toBeVisible();
}

for (const vp of VIEWPORTS) {
  test(`align scroll: last mismatch row reachable by wheel @ ${vp.width}x${vp.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    await openWideAlign(page);

    const main = page.locator(".align-main");
    const lastRow = page.locator(".align-table-row").last();
    await expect(lastRow).toContainText("col_extra_in_test");
    await expect(lastRow).toContainText("extra in test");

    // Fixture must be tall enough that the bottom row starts clipped.
    expect(await isFullyInViewport(lastRow)).toBe(false);

    await wheelUntilInView(page, main, lastRow);
    expect(await isFullyInViewport(lastRow)).toBe(true);

    const dropBtn = lastRow.getByRole("button", { name: "Drop from test" });
    await expect(dropBtn).toBeVisible();
    await dropBtn.click();

    await expect(
      page.getByText("drop_columns · col_extra_in_test · test"),
    ).toBeVisible();
  });
}
