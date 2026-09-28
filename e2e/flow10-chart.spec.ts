import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkspaceBench,
  titanicWorkspace,
  waitForGridReady,
} from "./helpers";

test("MAT-172: Chart builder — box, scatter+trendline, saved survives reload+step", async ({
  page,
}) => {
  test.setTimeout(240_000);
  clearFlowScreenshots("10-chart");
  await page.setViewportSize({ width: 1440, height: 900 });

  await openWorkspaceBench(page, titanicWorkspace(), "Fare");

  // Box: Fare by Pclass coloured by Survived
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "CLEAR_SELECTION" });
    d({ type: "PICK_COL", name: "Pclass" });
    d({ type: "PICK_COL", name: "Fare", add: true });
    d({ type: "PICK_COL", name: "Survived", add: true });
    d({
      type: "SET_CHART_DRAFT",
      draft: {
        chart: "box",
        x: "Pclass",
        y: "Fare",
        color: "Survived",
        facet_row: null,
        facet_col: null,
        size: null,
        columns: [],
        agg: null,
        trendline: false,
        log_x: false,
        log_y: false,
        bins: 30,
        sample_size: 10_000,
      },
    });
    d({ type: "OPEN_TOOL", id: "chart" });
  });

  const chart = page.locator('[data-tool="chart"]');
  await expect(chart).toBeVisible();
  await expect(chart.locator('[data-engine-key="chart"]')).toBeVisible({
    timeout: 60_000,
  });
  await expect(chart.locator("[data-chart-type]")).toHaveAttribute(
    "data-chart-type",
    "box",
  );
  await expect(chart.locator("[data-chart-x]")).toHaveAttribute(
    "data-chart-x",
    "Pclass",
  );
  await expect(chart.locator("[data-chart-y]")).toHaveAttribute(
    "data-chart-y",
    "Fare",
  );
  await expect(chart.locator("[data-chart-color]")).toHaveAttribute(
    "data-chart-color",
    "Survived",
  );
  await expect(chart.locator(".result-figure").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(chart.locator(".js-plotly-plot").first()).toBeVisible({
    timeout: 30_000,
  });
  await waitForGridReady(page);
  await captureFlowScreenshot(page, "10-chart", "01-box-fare-pclass-survived.png");

  // Scatter Age vs Fare with trendline
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({
      type: "SET_CHART_DRAFT",
      draft: {
        chart: "scatter",
        x: "Age",
        y: "Fare",
        color: null,
        facet_row: null,
        facet_col: null,
        size: null,
        columns: [],
        agg: null,
        trendline: true,
        log_x: false,
        log_y: false,
        bins: 30,
        sample_size: 10_000,
      },
    });
  });
  await expect(chart.locator("[data-chart-type]")).toHaveAttribute(
    "data-chart-type",
    "scatter",
  );
  await expect(chart.locator("[data-chart-trendline]")).toHaveAttribute(
    "data-chart-trendline",
    "1",
  );
  await expect(chart.locator(".result-figure").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(chart.locator(".result-metric", { hasText: "trendline" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(chart.locator(".js-plotly-plot").first()).toBeVisible({
    timeout: 30_000,
  });
  await waitForGridReady(page);
  await captureFlowScreenshot(page, "10-chart", "02-scatter-age-fare-trendline.png");

  // Save chart
  await chart.getByLabel("Chart name").fill("Age vs Fare trend");
  await chart.locator("[data-chart-save]").click();
  await expect(chart.getByLabel("Open saved chart")).toBeVisible();
  await expect(
    chart.locator("#chart-open-saved option", { hasText: "Age vs Fare trend" }),
  ).toHaveCount(1);

  // Survive reload
  await page.reload();
  await openWorkspaceBench(page, titanicWorkspace(), "Age");
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "OPEN_TOOL", id: "chart" });
  });
  const chart2 = page.locator('[data-tool="chart"]');
  await expect(chart2.getByLabel("Open saved chart")).toBeVisible({
    timeout: 60_000,
  });
  await chart2.getByLabel("Open saved chart").selectOption("Age vs Fare trend");
  await expect(chart2.locator("[data-chart-type]")).toHaveAttribute(
    "data-chart-type",
    "scatter",
  );
  await expect(chart2.locator("[data-chart-trendline]")).toHaveAttribute(
    "data-chart-trendline",
    "1",
  );
  await expect(chart2.locator(".result-figure").first()).toBeVisible({
    timeout: 60_000,
  });
  await waitForGridReady(page);
  await captureFlowScreenshot(page, "10-chart", "03-saved-after-reload.png");

  // Survive adding an impute step (re-render on current pipeline version)
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({
      type: "ADD_STEP",
      step: {
        op: "impute",
        target: "both",
        params: { columns: ["Age"], strategy: "median" },
      },
    });
  });
  await waitForGridReady(page);
  await expect(chart2.locator(".result-figure").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(chart2.locator("[data-chart-type]")).toHaveAttribute(
    "data-chart-type",
    "scatter",
  );
  // Saved list still present after the transform
  await expect(
    chart2.locator("#chart-open-saved option", { hasText: "Age vs Fare trend" }),
  ).toHaveCount(1);
  await captureFlowScreenshot(page, "10-chart", "04-after-impute-step.png");
});
