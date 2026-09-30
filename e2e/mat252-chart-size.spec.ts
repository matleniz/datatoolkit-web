import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkspaceBench,
  titanicWorkspace,
  waitForGridReady,
} from "./helpers";

const FLOW = "mat252-chart-size";

type Box = { x: number; y: number; width: number; height: number };

async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox();
  if (!b) throw new Error("element has no bounding box");
  return b;
}

async function dockLayout(page: Page) {
  return page.evaluate(() => window.__DTK_STATE__!().dock.layouts.bottom);
}

test("MAT-252: Chart opens with a larger default size (~half dock width, full height)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  clearFlowScreenshots(FLOW);
  await page.setViewportSize({ width: 1440, height: 900 });

  await openWorkspaceBench(page, titanicWorkspace(), "Age");

  // Open Chart and a standard default window (Distribution) side by side.
  // Chart gets w=6 (half the 12-col dock), Dist gets w=4 (1/3 dock width).
  // Both fit on row 0 (6 + 4 = 10 <= 12).
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "PICK_COL", name: "Age" });
    d({ type: "OPEN_TOOL", id: "chart" });
    d({ type: "OPEN_TOOL", id: "dist" });
  });

  const dock = page.getByLabel("Tool dock");
  const chart = dock.locator('.dock-window[data-tool="chart"]');
  const dist = dock.locator('.dock-window[data-tool="dist"]');

  await expect(chart).toBeVisible();
  await expect(dist).toBeVisible();

  // Wait for Chart figure to render.
  const chartPlot = chart.locator(".js-plotly-plot").first();
  await expect(chartPlot).toBeVisible({ timeout: 60_000 });
  await expect(chart.locator(".dock-msg:has-text('Loading…')")).toHaveCount(0, {
    timeout: 60_000,
  });

  // Check dock grid layout units:
  // Chart default is ~half dock width (w=6) and full height (h=8).
  // Standard tool (Distribution) keeps default w=4, h=8.
  // Both fit side by side on row 0 (6 + 4 = 10 <= 12).
  const layout = await dockLayout(page);
  expect(layout.chart).toEqual({ x: 0, y: 0, w: 6, h: 8 });
  expect(layout.dist).toEqual({ x: 6, y: 0, w: 4, h: 8 });

  // Verify pixel dimensions: Chart width is ~1.5x of standard 4-col windows
  // (~half dock width vs 1/3 dock width, giving ~2x visual figure area).
  const chartB = await box(chart);
  const distB = await box(dist);

  expect(chartB.width).toBeGreaterThan(distB.width * 1.4);

  // Verify the Plotly figure is fully visible and fills the Chart window comfortably.
  const figB = await box(chartPlot);
  expect(figB.width).toBeGreaterThan(350);
  expect(figB.height).toBeGreaterThan(150);
  expect(figB.x).toBeGreaterThanOrEqual(chartB.x);
  expect(figB.y).toBeGreaterThanOrEqual(chartB.y);

  await waitForGridReady(page);
  await captureFlowScreenshot(page, FLOW, "01-chart-larger-default-size.png");
});
