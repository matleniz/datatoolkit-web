import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkbench,
  waitForGridReady,
} from "./helpers";

test("Flow 5: compare + correlation windows, drag reorder, dock right, maximize (no loading states)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  clearFlowScreenshots("5-compare-dock");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Open workbench
  await openWorkbench(page, true);

  // Clear column selection
  await page.evaluate(() => {
    window.__DTK_DISPATCH__?.({ type: "CLEAR_SELECTION" });
  });

  // 2. Open Correlation matrix window
  await page.getByRole("button", { name: "Correlation matrix" }).click();
  const corrWindow = page.locator('[data-tool="corr"]');
  await expect(corrWindow).toBeVisible();

  // (c) Wait for real content, never screenshot a loading state
  await expect(
    corrWindow.locator('[data-engine-key="correlations"]'),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    corrWindow.locator("[data-corr-size]"),
  ).toBeVisible({ timeout: 30_000 });
  const corrSize = Number(
    await corrWindow.locator("[data-corr-size]").getAttribute("data-corr-size"),
  );
  expect(corrSize).toBeGreaterThanOrEqual(4);
  // Engine ResultView (matrix figure and/or high-pair tables)
  await expect(
    corrWindow.locator(".result-view").first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(corrWindow.locator("[data-dock-params='correlations']")).toBeVisible();

  // 3. Select columns age and sessions, then open Compare columns window
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "CLEAR_SELECTION" });
    d({ type: "PICK_COL", name: "age" });
    d({ type: "PICK_COL", name: "sessions", add: true });
  });

  await page.getByRole("button", { name: "Compare columns" }).click();
  const compareWindow = page.locator('[data-tool="compare"]');
  await expect(compareWindow).toBeVisible();

  // (c) Wait for real compare content, confirm stats loaded
  await expect(
    compareWindow.locator("[data-compare-cols]"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    compareWindow.locator('[data-stat="mean"][data-col="age"]'),
  ).not.toHaveText(/^[–—∅]?$/);
  await expect(
    compareWindow.locator('[data-stat="mean"][data-col="sessions"]'),
  ).not.toHaveText(/^[–—∅]?$/);

  // Confirm NO dock window has 'Loading…' text
  await expect(page.locator(".dock-window:has-text('Loading…')")).toHaveCount(0);

  // Screenshot 01: correlation + compare open in dock
  await waitForGridReady(page);
  await captureFlowScreenshot(
    page,
    "5-compare-dock",
    "01-dock-corr-compare.png",
  );

  // 4. Drag reorder
  const corrBar = page.locator('[data-tool="corr"] [data-drag="1"]');
  const compareBar = page.locator('[data-tool="compare"] [data-drag="1"]');
  await corrBar.dragTo(compareBar);
  await expect
    .poll(async () => page.evaluate(() => window.__DTK_STATE__?.()?.dock.tools[0]))
    .toBe("corr");

  await expect(page.locator(".dock-window:has-text('Loading…')")).toHaveCount(0);
  await waitForGridReady(page);
  await captureFlowScreenshot(page, "5-compare-dock", "02-dock-reordered.png");

  // 5. Dock right
  await page
    .getByRole("group", { name: "Dock position" })
    .getByRole("button", { name: "Right" })
    .click();
  await expect
    .poll(async () => page.evaluate(() => window.__DTK_STATE__?.()?.dock.pos))
    .toBe("right");

  await expect(page.locator(".dock-window:has-text('Loading…')")).toHaveCount(0);

  // Dock-right layout: assert position state + hit-testing. Geometric
  // boundingBox of the dock shell/windows inflates with matrix content until
  // FX-B's min-width:0 / overflow:hidden clamps land — do not use width checks.
  const dockShell = page.getByLabel("Tool dock");
  await expect(dockShell).toBeVisible();
  await expect(dockShell).toHaveClass(/dock-right/);

  const inspector = page.getByLabel("Inspector");
  await expect(inspector).toBeVisible();
  const inspectorBox = await inspector.boundingBox();
  expect(inspectorBox, "inspector has bounding box").not.toBeNull();

  // Inspector must remain hit-testable (not covered by dock overflow paint).
  const inspectorHits = await page.evaluate((box) => {
    const inspector = document.querySelector('[aria-label="Inspector"]');
    if (!inspector || !box) return [];
    const x = box.x + 10;
    const hits = [];
    for (let i = 0; i < 5; i++) {
      const y = box.y + (box.height * (i + 0.5)) / 5;
      const el = document.elementFromPoint(x, y);
      hits.push({
        x,
        y,
        inside: el !== null && (el === inspector || inspector.contains(el)),
      });
    }
    return hits;
  }, inspectorBox);
  expect(inspectorHits.length).toBe(5);
  for (const hit of inspectorHits) {
    expect(
      hit.inside,
      `elementFromPoint(${hit.x}, ${hit.y}) is inside the inspector`,
    ).toBe(true);
  }

  // Grid remains present beside the right dock.
  const grid = page.getByLabel("Data grid");
  await expect(grid).toBeVisible();
  const gridBox = await grid.boundingBox();
  expect(gridBox, "grid has bounding box").not.toBeNull();
  expect(gridBox!.width).toBeGreaterThan(100);

  await waitForGridReady(page);
  await captureFlowScreenshot(page, "5-compare-dock", "03-dock-right.png");

  // 6. Maximize compare window
  await compareWindow
    .getByRole("button", { name: "Maximize or restore" })
    .click();
  await expect
    .poll(async () =>
      page.evaluate(() => window.__DTK_STATE__?.()?.dock.maximized),
    )
    .toBe("compare");

  await expect(page.locator(".dock-window:has-text('Loading…')")).toHaveCount(0);
  // Grid is intentionally unmounted while a dock window is maximized — do not
  // waitForGridReady here.
  await captureFlowScreenshot(page, "5-compare-dock", "04-dock-maximized.png");

  // Restore
  await compareWindow
    .getByRole("button", { name: "Maximize or restore" })
    .click();
  await expect
    .poll(async () =>
      page.evaluate(() => window.__DTK_STATE__?.()?.dock.maximized),
    )
    .toBeNull();
});
