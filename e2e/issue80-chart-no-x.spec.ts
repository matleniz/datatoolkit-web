/**
 * #80 — opening Chart with no column selected sends no request and shows a
 * neutral hint (no engine-error banner); picking X runs the chart once.
 */
import { expect, test } from "@playwright/test";

import { openWorkspaceBench, titanicWorkspace } from "./helpers";

test("#80: Chart with no X: no run, hint, then one run on pick", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspaceBench(page, titanicWorkspace(), "Age");

  const runs: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/keys/chart/run")) {
      runs.push(r.postData() ?? "");
    }
  });

  await page
    .getByRole("navigation", { name: "Analysis tools" })
    .getByRole("button", { name: "Chart", exact: true })
    .click();
  const chart = page.locator('.dock-window[data-tool="chart"]');
  await expect(chart.locator("[data-chart-hint]")).toHaveText("Pick X");
  await expect(chart.locator(".engine-error")).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(runs).toHaveLength(0);

  await chart.locator("#chart-x").selectOption("Age");
  await expect(chart.locator(".result-figure .js-plotly-plot").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(chart.locator("[data-chart-hint]")).toHaveCount(0);
  await expect(chart.locator(".engine-error")).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(runs).toHaveLength(1);
});
