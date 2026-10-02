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

/** Switch view via its tab, or via the compact select when the bar folds (MAT-247). */
async function pickView(win: Locator, id: string) {
  const tab = win.locator(`[data-view-tab="${id}"]`);
  if (await tab.isVisible()) await tab.click();
  else await win.locator("[data-view-select]").selectOption(id);
}

/** Where "Cabin" sits among the category ticks (either axis: bars may be horizontal). */
async function cabinEnd(figure: Locator): Promise<"first" | "last" | "mid" | "none"> {
  const labels = (await figure.locator(".xtick text, .ytick text").allTextContents())
    .map((t) => t.trim())
    .filter((t) => t && !/^[-\d.,%kM\s−]+$/.test(t));
  const i = labels.indexOf("Cabin");
  if (i < 0) return "none";
  return i === 0 ? "first" : i === labels.length - 1 ? "last" : "mid";
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
  // Table view is offered: as a tab, or as an option once the bar folds (MAT-247).
  if (await missing.locator(".result-tabs").isVisible()) {
    await expect(missing.locator('[data-view-tab="table"]')).toBeVisible();
  } else {
    await expect(missing.locator('[data-view-select] option[value="table"]')).toHaveCount(1);
  }
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
  await expect.poll(() => cabinEnd(figure)).toMatch(/^(first|last)$/);
  const descEnd = await cabinEnd(figure);
  await missing.getByLabel("Sort bars").selectOption("asc");
  await expect.poll(() => cabinEnd(figure)).not.toBe(descEnd);
  await missing.getByLabel("Sort bars").selectOption("desc");
  await expect.poll(() => cabinEnd(figure)).toBe(descEnd);
  await missing.getByRole("checkbox", { name: "Log" }).check();
  await expect(figure.locator(".main-svg").first()).toBeVisible();
  await missing.getByRole("checkbox", { name: "Log" }).uncheck();
  expect(runs.length).toBe(before);

  // --- View switcher: another figure, then the Table view ---
  const otherTab = missing
    .locator('[role="tab"][data-view-tab^="figure:"][aria-selected="false"]')
    .first();
  const otherId = await otherTab.getAttribute("data-view-tab");
  // #73: the tabs fold into the select when they overflow the bar.
  if (await otherTab.isVisible()) await otherTab.click();
  else await missing.locator("[data-view-select]").selectOption(otherId!);
  await expect(shell).toHaveAttribute("data-view", otherId!);
  await expect(missing.locator(".result-figure .main-svg").first()).toBeVisible();
  await captureFlowScreenshot(page, FLOW, "02-missing-after-view-change.png");

  await pickView(missing, "table");
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
  await pickView(missing, initialView!);
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
  await pickView(missing, initialView!);
  await missing.getByLabel("Sort bars").selectOption("desc");
  await expect.poll(() => cabinEnd(figure)).toBe(descEnd);
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
  // MAT-246: default window size shows readable figures (height >= 180 px),
  // completely contained inside the window (no scroll), with x axis rendered.
  for (const id of ["missing", "dist", "outliers"] as const) {
    const w = win(page, id);
    const wBox = await box(w);
    const fig = w.locator(".result-figure").first();
    const fBox = await box(fig);
    // Bounding box of the figure is strictly contained in the window bounding box
    expect(fBox.y).toBeGreaterThanOrEqual(wBox.y);
    expect(fBox.y + fBox.height).toBeLessThanOrEqual(wBox.y + wBox.height + 1);
    expect(fBox.height).toBeGreaterThanOrEqual(180);

    // And the x axis is rendered
    const xAxis = w.locator(".result-figure .xaxislayer-above, .result-figure .xtick, .result-figure .g-xtitle").first();
    await expect(xAxis).toBeVisible();

    // Window body has no vertical scroll (fits without scroll)
    const hasScroll = await w
      .locator(".dock-body")
      .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(hasScroll).toBe(false);

    // MAT-247: the Parameters chip and the bound label never overlap.
    const chip = w.locator(".dock-subchrome .dock-params-chip").first();
    if (await chip.isVisible()) {
      const cBox = await box(chip);
      const bound = w.locator(".dock-subchrome .dock-bound").first();
      if ((await bound.count()) > 0 && (await bound.isVisible())) {
        const bBox = await box(bound);
        expect(cBox.x + cBox.width).toBeLessThanOrEqual(bBox.x + 0.5);
      }
    }

    // MAT-247: view choices are readable (>= 3 visible characters) or folded
    // into a select / "..." menu — never 1-2 letter chips.
    const tabs = w.locator('.result-tabs [role="tab"]');
    if (await w.locator(".result-tabs").isVisible()) {
      for (const t of await tabs.all()) {
        const txt = ((await t.textContent()) ?? "").trim();
        const tb = await box(t);
        expect(tb.width).toBeGreaterThan(24);
        expect(txt.length >= 3 || tb.width >= 40).toBe(true);
        const clipped = await t.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(clipped).toBe(false);
      }
    } else {
      await expect(w.locator("[data-view-select]")).toBeVisible();
    }
  }

  // MAT-246: Plotly mode bar is only visible on hover
  const outliersFig = win(page, "outliers").locator(".result-figure").first();
  const modeBar = outliersFig.locator(".modebar-container, .modebar").first();
  await page.mouse.move(0, 0);
  await expect(modeBar).toHaveCSS("opacity", "0");
  await outliersFig.hover();
  await expect(modeBar).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await expect(modeBar).toHaveCSS("opacity", "0");

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
