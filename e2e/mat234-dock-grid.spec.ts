import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkspaceBench,
  titanicWorkspace,
  waitForGridReady,
} from "./helpers";

const FLOW = "mat234-dock-grid";
/** Must match Dock.tsx GRID_MARGIN / DOCK_GRID.bottom. */
const MARGIN = 10;
const COLS = 12;
const ROWS = 8;

type Box = { x: number; y: number; width: number; height: number };
type ToolId = "dist" | "missing" | "chart";

async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

/** Wait for a grid item to finish its move / resize transition. */
async function settled(loc: Locator): Promise<Box> {
  let prev = await box(loc);
  for (let i = 0; i < 40; i++) {
    await loc.page().waitForTimeout(50);
    const next = await box(loc);
    if (JSON.stringify(next) === JSON.stringify(prev)) return next;
    prev = next;
  }
  return prev;
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - 1 &&
    b.x < a.x + a.width - 1 &&
    a.y < b.y + b.height - 1 &&
    b.y < a.y + a.height - 1
  );
}

/** Mouse drag in small steps (react-draggable needs real move events). */
async function drag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + Math.sign(dx) * 4, from.y + Math.sign(dy) * 4, {
    steps: 2,
  });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 15 });
  await page.mouse.up();
}

async function dockLayout(page: Page) {
  return page.evaluate(() => window.__DTK_STATE__!().dock.layouts.bottom);
}

/** Pixel size of one grid column / row step (cell + margin). */
async function gridStep(page: Page): Promise<{ col: number; row: number }> {
  const wins = await box(page.locator(".dock-wins"));
  const colW = (wins.width - MARGIN * (COLS - 1)) / COLS;
  const rowH = (wins.height - MARGIN * (ROWS - 1)) / ROWS;
  return { col: colW + MARGIN, row: Math.floor(rowH) + MARGIN };
}

function cell(page: Page, id: ToolId): Locator {
  return page.locator(`.react-grid-item:has(.dock-window[data-tool="${id}"])`);
}

/** Drag a window's title bar by whole grid cells. */
async function moveBy(page: Page, id: ToolId, cols: number, rows: number) {
  const step = await gridStep(page);
  await settled(cell(page, id));
  const title = cell(page, id).locator(".dock-win-title");
  await title.scrollIntoViewIfNeeded();
  const t = await box(title);
  await drag(
    page,
    { x: t.x + 8, y: t.y + t.height / 2 },
    cols * step.col,
    rows * step.row,
  );
}

/** Drag a window's resize handle by whole grid cells. */
async function resizeBy(
  page: Page,
  id: ToolId,
  handle: "se" | "e" | "s",
  cols: number,
  rows: number,
) {
  const step = await gridStep(page);
  await settled(cell(page, id));
  const h = cell(page, id).locator(`.react-resizable-handle-${handle}`);
  await h.scrollIntoViewIfNeeded();
  const b = await box(h);
  await drag(
    page,
    { x: b.x + b.width / 2, y: b.y + b.height / 2 },
    cols * step.col,
    rows * step.row,
  );
}

async function expectNoOverlap(wins: Locator[]): Promise<void> {
  const boxes = await Promise.all(wins.map(settled));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
    }
  }
}

test("MAT-234: dock windows move and resize on a grid, layout survives reload", async ({
  page,
}) => {
  test.setTimeout(240_000);
  clearFlowScreenshots(FLOW);
  await page.setViewportSize({ width: 1440, height: 900 });

  await openWorkspaceBench(page, titanicWorkspace(), "Age");
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_DOCK_SIZE", size: "L" });
    d({ type: "PICK_COL", name: "Age" });
    d({ type: "OPEN_TOOL", id: "dist" });
    d({ type: "OPEN_TOOL", id: "missing" });
  });

  const dock = page.getByLabel("Tool dock");
  const dist = dock.locator('.dock-window[data-tool="dist"]');
  const missing = dock.locator('.dock-window[data-tool="missing"]');
  const chart = dock.locator('.dock-window[data-tool="chart"]');
  const wins = [dist, missing, chart];
  // One figure-building key at a time: the engine's concurrent Plotly
  // figure construction can fail with "Invalid value" (engine-side race).
  await expect(dist.locator(".result-figure .js-plotly-plot").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(".dock-window:has-text('Loading…')")).toHaveCount(0, {
    timeout: 60_000,
  });
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "OPEN_TOOL", id: "chart" });
  });
  for (const w of wins) await expect(w).toBeVisible();
  await expect(chart.locator(".js-plotly-plot").first()).toBeVisible({
    timeout: 60_000,
  });

  // Default grid: three equal windows side by side, filling the dock height.
  expect(await dockLayout(page)).toEqual({
    dist: { x: 0, y: 0, w: 4, h: 8 },
    missing: { x: 4, y: 0, w: 4, h: 8 },
    chart: { x: 8, y: 0, w: 4, h: 8 },
  });
  await expectNoOverlap(wins);
  await waitForGridReady(page);
  await captureFlowScreenshot(page, FLOW, "01-default-grid.png");

  // 1) Resize Distribution and Missing to half height (bottom edge).
  await resizeBy(page, "dist", "s", 0, -4);
  await expect.poll(async () => (await dockLayout(page)).dist?.h).toBe(4);
  await resizeBy(page, "missing", "s", 0, -4);
  await expect.poll(async () => (await dockLayout(page)).missing?.h).toBe(4);

  // 2) Move Chart to the far left: it takes (0, 0) and pushes Distribution
  //    down (windows never overlap).
  await moveBy(page, "chart", -8, 0);
  await expect
    .poll(async () => {
      const l = await dockLayout(page);
      return [l.chart?.x, l.chart?.y];
    })
    .toEqual([0, 0]);
  await expectNoOverlap(wins);

  // 3) Move Distribution to the top of the right column, Missing under it.
  let l = await dockLayout(page);
  await moveBy(page, "dist", 8 - l.dist!.x, -l.dist!.y);
  await expect
    .poll(async () => {
      const n = await dockLayout(page);
      return [n.dist?.x, n.dist?.y];
    })
    .toEqual([8, 0]);
  l = await dockLayout(page);
  await moveBy(page, "missing", 8 - l.missing!.x, 4 - l.missing!.y);
  await expect
    .poll(async () => {
      const n = await dockLayout(page);
      return [n.missing?.x, n.missing?.y];
    })
    .toEqual([8, 4]);
  await expectNoOverlap(wins);

  // 4) Widen Chart over the freed middle columns (right edge); the Plotly
  //    figure re-lays out to the new width once the resize ends.
  await page.locator(".dock-wins").evaluate((el) => el.scrollTo(0, 0));
  const plotSvg = chart.locator(".js-plotly-plot .main-svg").first();
  const svgBefore = await box(plotSvg);
  await resizeBy(page, "chart", "e", 4, 0);
  await expect.poll(async () => (await dockLayout(page)).chart?.w).toBe(8);
  await expect
    .poll(async () => (await box(plotSvg)).width, { timeout: 10_000 })
    .toBeGreaterThan(svgBefore.width * 1.6);
  await expectNoOverlap(wins);

  const layoutBefore = await dockLayout(page);
  expect(layoutBefore).toEqual({
    chart: { x: 0, y: 0, w: 8, h: 8 },
    dist: { x: 8, y: 0, w: 4, h: 4 },
    missing: { x: 8, y: 4, w: 4, h: 4 },
  });
  await page.locator(".dock-wins").evaluate((el) => el.scrollTo(0, 0));
  const boxesBefore = await Promise.all(wins.map(settled));
  await waitForGridReady(page);
  await captureFlowScreenshot(page, FLOW, "02-moved-resized.png");

  // 5) Reload: same windows, same layout, nothing re-opened by hand.
  await page.reload();
  await openWorkspaceBench(page, titanicWorkspace(), "Age");
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({ type: "PICK_COL", name: "Age" });
  });
  for (const w of wins) await expect(w).toBeVisible();
  expect(await dockLayout(page)).toEqual(layoutBefore);
  await expect(dist.locator(".result-figure .js-plotly-plot").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(".dock-window:has-text('Loading…')")).toHaveCount(0, {
    timeout: 60_000,
  });
  // The chart draft itself is not persisted (only saved charts are): pick X.
  await chart.getByLabel("X", { exact: true }).selectOption("Age");
  await expect(chart.locator(".js-plotly-plot").first()).toBeVisible({
    timeout: 60_000,
  });
  const boxesAfter = await Promise.all(wins.map(settled));
  for (let i = 0; i < wins.length; i++) {
    const [a, b] = [boxesAfter[i]!, boxesBefore[i]!];
    expect(Math.abs(a.x - b.x)).toBeLessThan(2);
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
    expect(Math.abs(a.height - b.height)).toBeLessThan(2);
  }
  await expect(dist.locator(".result-figure .js-plotly-plot").first()).toBeVisible({
    timeout: 60_000,
  });
  await waitForGridReady(page);
  await captureFlowScreenshot(page, FLOW, "03-after-reload.png");

  // 6) Maximize still takes the whole centre; restore returns to the grid.
  await chart.getByRole("button", { name: "Maximize or restore" }).click();
  await expect(dist).toBeHidden();
  await expect(page.getByLabel("Data grid")).toBeHidden();
  await chart.getByRole("button", { name: "Maximize or restore" }).click();
  await expect(dist).toBeVisible();
  expect(await dockLayout(page)).toEqual(layoutBefore);

  // 7) Right dock keeps its own layout; switching back restores bottom.
  await dock.getByRole("button", { name: "Right" }).click();
  await expect(page.locator(".dock-right")).toBeVisible();
  const right = await Promise.all(wins.map(settled));
  // Full-width windows stacked in the narrow pane.
  expect(Math.abs(right[0]!.x - right[1]!.x)).toBeLessThan(2);
  await expectNoOverlap(wins);
  await waitForGridReady(page);
  await captureFlowScreenshot(page, FLOW, "04-right-dock.png");
  await dock.getByRole("button", { name: "Bottom" }).click();
  expect(await dockLayout(page)).toEqual(layoutBefore);
});
