/**
 * MAT-240 — Chart window: chart type as icon tiles (greyed when the selection
 * cannot feed them), compact x / y / colour row, advanced knobs under "More",
 * figure filling the window. Acceptance: scatter coloured by the target in
 * 3 clicks from a 2-column selection.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkspaceBench,
  titanicWorkspace,
  waitForGridReady,
} from "./helpers";

const FLOW = "mat240-chart-picker";

async function figureDrawn(chart: Locator) {
  await expect(chart.locator(".result-figure .js-plotly-plot").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(chart.locator(".dock-msg", { hasText: "Loading…" })).toHaveCount(0, {
    timeout: 60_000,
  });
}

async function runChart(page: Page): Promise<Record<string, unknown>> {
  const body = page.locator('.dock-window[data-tool="chart"] .chart-dock');
  const raw = await body.getAttribute("data-run-params");
  return JSON.parse(raw ?? "{}") as Record<string, unknown>;
}

test("MAT-240: icon chart picker, scatter by target in 3 clicks", async ({ page }) => {
  test.setTimeout(240_000);
  clearFlowScreenshots(FLOW);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspaceBench(page, titanicWorkspace(), "Age");

  // Starting point: the user has two numeric columns selected in the grid.
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "CLEAR_SELECTION" });
    d({ type: "PICK_COL", name: "Age" });
    d({ type: "PICK_COL", name: "Fare", add: true });
  });
  await waitForGridReady(page);

  let clicks = 0;
  const click = async (loc: Locator) => {
    await loc.click();
    clicks += 1;
  };

  // Click 1: Chart in the tool rail.
  await click(
    page.getByRole("navigation", { name: "Analysis tools" }).getByRole("button", {
      name: "Chart",
      exact: true,
    }),
  );
  const chart = page.locator('.dock-window[data-tool="chart"]');
  const body = chart.locator(".chart-dock");
  await expect(body).toBeVisible();

  // Tiles: scatter recommended for 2 numeric columns; incompatible ones greyed
  // with the reason as hover text.
  const tiles = chart.getByRole("radiogroup", { name: "Chart type" });
  await expect(tiles.getByRole("radio")).toHaveCount(9);
  const scatter = tiles.locator('[data-chart-tile="scatter"]');
  await expect(scatter).toHaveAttribute("data-recommended", "1");
  const matrix = tiles.locator('[data-chart-tile="scatter_matrix"]');
  await expect(matrix).toHaveAttribute("aria-disabled", "true");
  await expect(matrix).toHaveAttribute("title", /needs 3 numeric columns/);
  const pie = tiles.locator('[data-chart-tile="pie"]');
  await expect(pie).toHaveAttribute("aria-disabled", "true");
  await expect(pie).toHaveAttribute("title", /needs a column with at most/);
  // A greyed tile ignores clicks.
  await matrix.click({ force: true });
  await expect(body).not.toHaveAttribute("data-chart-type", "scatter_matrix");

  // Click 2: the Scatter tile.
  await click(scatter);
  await expect(scatter).toHaveAttribute("aria-checked", "true");
  await expect(body).toHaveAttribute("data-chart-type", "scatter");
  await expect(body).toHaveAttribute("data-chart-x", "Age");
  await expect(body).toHaveAttribute("data-chart-y", "Fare");

  // Click 3: colour by the target.
  const byTarget = chart.locator("[data-chart-color-target]");
  await expect(byTarget).toHaveAttribute("aria-pressed", "false");
  await click(byTarget);
  await expect(byTarget).toHaveAttribute("aria-pressed", "true");
  await expect(body).toHaveAttribute("data-chart-color", "Survived");
  await figureDrawn(chart);
  await expect
    .poll(async () => runChart(page), { timeout: 60_000 })
    .toMatchObject({ chart: "scatter", x: "Age", y: "Fare", color: "Survived" });
  expect(clicks).toBe(3);

  // Advanced knobs stay folded until "More".
  await expect(chart.locator("#chart-more")).toHaveCount(0);
  await expect(chart.getByLabel("Sample size")).toHaveCount(0);

  // The figure takes most of the window.
  const winBox = await chart.boundingBox();
  const plotBox = await chart.locator(".result-plot-box").first().boundingBox();
  expect(winBox && plotBox).toBeTruthy();
  expect(plotBox!.height).toBeGreaterThan(winBox!.height * 0.4);
  await waitForGridReady(page);
  await captureFlowScreenshot(page, FLOW, "01-scatter-by-target-3-clicks.png");

  // Maximised window: the figure follows the new size.
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "SET_MAXIMIZED", id: "chart" });
  });
  await expect
    .poll(
      async () =>
        (await chart.locator(".result-plot-box").first().boundingBox())?.height ?? 0,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(plotBox!.height + 100);
  await expect
    .poll(
      async () => {
        const svg = await chart.locator(".result-figure .main-svg").first().boundingBox();
        const boxNow = await chart.locator(".result-plot-box").first().boundingBox();
        return svg && boxNow ? Math.abs(svg.height - boxNow.height) : 999;
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(4);

  // "More" opens the advanced knobs; trendline still reaches the engine.
  await chart.locator("[data-chart-more]").click();
  await expect(chart.locator("#chart-more")).toBeVisible();
  await chart.getByLabel("Trendline").check();
  await expect(body).toHaveAttribute("data-chart-trendline", "1");
  await figureDrawn(chart);
  await expect(chart.locator("[data-chart-more]")).toContainText("More · 1");
  await captureFlowScreenshot(page, FLOW, "02-maximized-more-open.png");

  // Switching tile re-maps the encoding (histogram of Age, colour kept).
  await tiles.locator('[data-chart-tile="histogram"]').click();
  await expect(body).toHaveAttribute("data-chart-type", "histogram");
  await expect(body).toHaveAttribute("data-chart-x", "Age");
  await expect(body).toHaveAttribute("data-chart-y", "");
  await expect(body).toHaveAttribute("data-chart-color", "Survived");
  await figureDrawn(chart);

  // Back to the dock layout; a text-only selection greys the numeric types.
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "SET_MAXIMIZED", id: null });
  });
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "CLEAR_SELECTION" });
    d({ type: "PICK_COL", name: "Sex" });
  });
  // Sex + the plotted Age: scatter (2 numeric) greyed, bar recommended.
  await expect(tiles.locator('[data-chart-tile="bar"]')).toHaveAttribute(
    "data-recommended",
    "1",
  );
  await expect(tiles.locator('[data-chart-tile="scatter"]')).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await waitForGridReady(page);
  await captureFlowScreenshot(page, FLOW, "03-text-selection-greys-numeric-types.png");
});
