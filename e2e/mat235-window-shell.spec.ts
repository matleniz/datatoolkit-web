/**
 * MAT-235 — shared analysis-window frame: figure first (filling the window),
 * view switcher, front-only display controls, collapsed Details, Open in
 * Chart, Plotly mode bar, click-through to the grid selection.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openDetails,
  openWorkspaceBench,
  titanicWorkspace,
  waitForGridReady,
} from "./helpers";

const FLOW = "mat235-window-shell";

type Tool = "missing" | "dist" | "outliers" | "corr" | "chart";

type Box = { x: number; y: number; width: number; height: number };

async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

function win(page: Page, id: Tool): Locator {
  return page.locator(`.dock-window[data-tool="${id}"]`);
}

/** Wait until a window shows its figure (never several keys in flight). */
async function figureReady(page: Page, id: Tool): Promise<Locator> {
  const w = win(page, id);
  await expect(w.locator(".result-figure .js-plotly-plot").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(".dock-window:has-text('Loading…')")).toHaveCount(0, {
    timeout: 60_000,
  });
  return w;
}

/** `col`: select only that column; null: clear; omitted: keep the selection. */
async function openTool(page: Page, id: Tool, col?: string | null) {
  await page.evaluate(
    ({ id: t, col: c }) => {
      const d = window.__DTK_DISPATCH__!;
      if (c !== undefined) {
        d({ type: "CLEAR_SELECTION" });
        if (c) d({ type: "PICK_COL", name: c });
      }
      d({ type: "OPEN_TOOL", id: t });
    },
    { id, col },
  );
  return figureReady(page, id);
}

async function maximize(page: Page, id: Tool | null) {
  await page.evaluate((t) => {
    window.__DTK_DISPATCH__!({ type: "SET_MAXIMIZED", id: t });
  }, id);
}

async function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__DTK_STATE__!().selection.columns);
}

/** Click the centre of an element with a real mouse event (Plotly hit-test). */
async function clickCentre(page: Page, loc: Locator) {
  const b = await box(loc);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

test("MAT-235: figure-first analysis windows", async ({ page }) => {
  test.setTimeout(360_000);
  clearFlowScreenshots(FLOW);
  const runs: string[] = [];
  page.on("request", (r) => {
    const m = /\/keys\/([^/]+)\/run$/.exec(new URL(r.url()).pathname);
    if (m && r.method() === "POST") runs.push(m[1]!);
  });

  await openWorkspaceBench(page, titanicWorkspace(), "Age");

  // --- Missing values (all columns): headline → figure → views → Details ---
  const missingRun = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/keys\/missing_values\/run$/.test(r.url()),
  );
  const missing = await openTool(page, "missing", null);
  const shell = missing.locator(".result-shell");
  await expect(shell).toHaveAttribute("data-view", /^figure:\d+$/);
  await expect(missing.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  // Real engine (MAT-244): the headline line and the `main` figure as default.
  const real = (await (await missingRun).json()) as {
    headline?: string;
    figures: { main?: boolean }[];
  };
  expect(real.headline?.trim()).toBeTruthy();
  await expect(missing.locator("[data-result-headline]")).toHaveText(real.headline!.trim());
  const mainIdx = real.figures.findIndex((f) => f.main === true);
  expect(mainIdx).toBeGreaterThanOrEqual(0);
  await expect(shell).toHaveAttribute("data-view", `figure:${mainIdx}`);
  // Default = the `main` figure, else the first.
  await expect(missing.locator('[data-view-tab="table"]')).toBeVisible();
  const details = missing.locator(".result-details");
  await expect(details).toHaveAttribute("data-details-open", "0");
  await expect(missing.locator(".result-table-block")).toHaveCount(0);
  // Plotly mode bar (PNG / SVG export) on analysis figures too.
  await expect(missing.locator(".modebar").first()).toBeAttached();

  // Order and size: the figure comes before the view bar and the drawer,
  // and takes most of the window's height.
  await maximize(page, "missing");
  const figure = missing.locator(".result-figure").first();
  await expect(figure.locator(".main-svg").first()).toBeVisible();
  const [bodyBox, figBox, barBox, detBox] = await Promise.all([
    box(missing.locator(".dock-body")),
    box(figure),
    box(missing.locator(".result-viewbar")),
    box(details),
  ]);
  expect(figBox.y).toBeLessThan(barBox.y);
  expect(barBox.y).toBeLessThan(detBox.y);
  // The figure takes the room left under the Parameters panel: the drawer
  // ends at the bottom of the window, and the plot outgrows the old 220 px.
  expect(detBox.y + detBox.height).toBeGreaterThan(bodyBox.y + bodyBox.height - 24);
  expect(figBox.height).toBeGreaterThan(260);
  // The plot itself fills its box (height follows the window, not 220 px).
  await expect
    .poll(async () => (await box(figure.locator(".main-svg").first())).height)
    .toBeGreaterThan(figBox.height * 0.9);
  const initialView = await shell.getAttribute("data-view");
  await captureFlowScreenshot(page, FLOW, "01-missing-before-view-change.png");

  // Front-only display: sorting re-draws without re-running the key.
  const before = runs.length;
  await missing.getByLabel("Sort bars").selectOption("desc");
  await expect(figure.locator(".xtick text").first()).toHaveText("Cabin");
  await missing.getByLabel("Sort bars").selectOption("asc");
  await expect(figure.locator(".xtick text").first()).not.toHaveText("Cabin");
  await missing.getByLabel("Sort bars").selectOption("desc");
  await expect(figure.locator(".xtick text").first()).toHaveText("Cabin");
  await missing.getByRole("checkbox", { name: "Log" }).check();
  await expect(figure.locator(".main-svg").first()).toBeVisible();
  await missing.getByRole("checkbox", { name: "Log" }).uncheck();
  expect(runs.length).toBe(before);

  // --- View switcher: another figure, then the Table view ---
  const otherTab = missing
    .locator('[role="tab"][data-view-tab^="figure:"][aria-selected="false"]')
    .first();
  const otherId = await otherTab.getAttribute("data-view-tab");
  await otherTab.click();
  await expect(shell).toHaveAttribute("data-view", otherId!);
  await expect(missing.locator(".result-figure .main-svg").first()).toBeVisible();
  await captureFlowScreenshot(page, FLOW, "02-missing-after-view-change.png");

  await missing.locator('[data-view-tab="table"]').click();
  await expect(shell).toHaveAttribute("data-view", "table");
  const rates = missing.locator(".result-main .result-table-block", {
    hasText: "missing_rates",
  });
  await expect(rates).toBeVisible();
  // Sortable tables: click a header.
  const th = rates.locator("th").first();
  await th.locator("button").click();
  await expect(th).toHaveAttribute("aria-sort", "ascending");
  await th.locator("button").click();
  await expect(th).toHaveAttribute("aria-sort", "descending");

  // Remembered per window: close and reopen Missing → still the Table view.
  await maximize(page, null);
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "TOGGLE_TOOL", id: "missing" });
    d({ type: "OPEN_TOOL", id: "missing" });
  });
  await expect(missing.locator(".result-shell")).toHaveAttribute("data-view", "table", {
    timeout: 60_000,
  });

  // Back to the default figure; Details drawer: metric tiles + tables.
  await missing.locator(`[data-view-tab="${initialView}"]`).click();
  await expect(shell).toHaveAttribute("data-view", initialView!);
  await maximize(page, "missing");
  await openDetails(missing);
  await expect(missing.locator(".result-details .result-metric").first()).toBeVisible();
  await expect(
    missing.locator(".result-details .result-table-block", { hasText: "missing_rates" }),
  ).toBeVisible();
  await captureFlowScreenshot(page, FLOW, "03-details-open.png");
  await missing.locator(".result-details-toggle").click();
  await expect(details).toHaveAttribute("data-details-open", "0");

  // --- Click-through: a bar named after a column selects it in the grid ---
  await missing.locator(`[data-view-tab="${initialView}"]`).click();
  await missing.getByLabel("Sort bars").selectOption("desc");
  await expect(figure.locator(".xtick text").first()).toHaveText("Cabin");
  await clickCentre(page, figure.locator(".bars .point path").first());
  await expect.poll(() => selection(page)).toEqual(["Cabin"]);
  // The clicked window keeps showing every column (scope widened).
  await expect(missing.locator("[data-scope-mode]").first()).toHaveAttribute(
    "data-scope-mode",
    "all",
  );
  await maximize(page, null);
  await figureReady(page, "missing");

  // --- Distribution on Age → Open in Chart prefills the same column ---
  const dist = await openTool(page, "dist", "Age");
  await expect(dist.locator("[data-result-headline]")).not.toBeEmpty();
  await maximize(page, "dist");
  await captureFlowScreenshot(page, FLOW, "04-distribution.png");
  await dist.locator("[data-open-in-chart]").click();
  await maximize(page, null);
  const chart = await figureReady(page, "chart");
  const chartBody = chart.locator(".chart-dock");
  await expect(chartBody).toHaveAttribute("data-chart-type", "histogram");
  await expect(chartBody).toHaveAttribute("data-chart-x", "Age");
  // Chart fills its window too (no fixed 280 px plot).
  const plot = chart.locator(".result-figure .main-svg").first();
  await expect(plot).toBeVisible();
  await captureFlowScreenshot(page, FLOW, "05-open-in-chart.png");
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "TOGGLE_TOOL", id: "chart" });
  });

  // --- Outliers on Age, Correlation on all numeric columns ---
  const outliers = await openTool(page, "outliers", "Age");
  await expect(outliers.locator("[data-result-headline]")).not.toBeEmpty();
  await maximize(page, "outliers");
  await captureFlowScreenshot(page, FLOW, "06-outliers.png");
  await maximize(page, null);
  const corr = await openTool(page, "corr");
  await expect(corr.locator("[data-result-headline]")).not.toBeEmpty();
  await maximize(page, "corr");
  await captureFlowScreenshot(page, FLOW, "07-correlation.png");
  await maximize(page, null);

  // All four analysis windows side by side on titanic.
  for (const id of ["missing", "dist", "outliers", "corr"] as const) {
    await figureReady(page, id);
  }
  await waitForGridReady(page);
  await captureFlowScreenshot(page, FLOW, "08-four-windows.png");

  // --- Click-through on a heatmap cell: its column pair is selected ---
  await maximize(page, "corr");
  const drag = corr.locator(".result-figure .nsewdrag").first();
  const d = await box(drag);
  await page.mouse.click(d.x + d.width * 0.25, d.y + d.height * 0.75);
  await expect
    .poll(async () => (await selection(page)).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  const numeric = await page.evaluate(() =>
    window.__DTK_STATE__!().selection.columns.every((c) =>
      ["Age", "Fare", "SibSp", "Parch", "Pclass", "PassengerId", "Survived"].includes(c),
    ),
  );
  expect(numeric).toBe(true);
  await maximize(page, null);
});

test("MAT-235: headline and main figure from the Result contract", async ({ page }) => {
  test.setTimeout(180_000);
  // Engine MAT-244 may not be deployed yet: add the optional fields here.
  await page.route("**/keys/missing_values/run", async (route) => {
    const resp = await route.fetch();
    const json = (await resp.json()) as {
      headline?: string;
      figures: { main?: boolean }[];
    };
    json.headline = "3 columns have missing values; 1 above 30 %";
    json.figures.forEach((f, i) => (f.main = i === 1));
    await route.fulfill({ response: resp, json });
  });
  await openWorkspaceBench(page, titanicWorkspace(), "Age");
  const missing = await openTool(page, "missing", null);
  await expect(missing.locator("[data-result-headline]")).toHaveText(
    "3 columns have missing values; 1 above 30 %",
  );
  await expect(missing.locator(".result-shell")).toHaveAttribute("data-view", "figure:1");
  await expect(missing.locator('[data-view-tab="figure:1"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
