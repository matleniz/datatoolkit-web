import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Workspace } from "../src/api/types";

/**
 * Opt-in journey on a real very large CSV (#329): `DTK_BIG_CSV=/path/to/4M-rows.csv`.
 * Prints browser and server memory around the scrolling; screenshots go to
 * e2e/screenshots/continuous-scroll. Skipped when the variable is not set.
 */
const csv = process.env.DTK_BIG_CSV;
const apiPort = process.env.DTK_E2E_API_PORT ?? "8766";
const shots = join(dirname(fileURLToPath(import.meta.url)), "screenshots", "continuous-scroll");

/** Resident set (MB) of the engine listening on the e2e port; `hwm` = peak (VmHWM). */
function serverRssMb(hwm = false): number {
  const pid = execSync(`ss -ltnpH 'sport = :${apiPort}'`).toString().match(/pid=(\d+)/)?.[1];
  if (!pid) return NaN;
  const m = readFileSync(`/proc/${pid}/status`, "utf8").match(hwm ? /VmHWM:\s+(\d+) kB/ : /VmRSS:\s+(\d+) kB/);
  return m ? Math.round(Number(m[1]) / 1024) : NaN;
}

async function heapMb(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  await cdp.detach();
  return Math.round((metrics.find((x) => x.name === "JSHeapUsedSize")?.value ?? 0) / 1048576);
}

test("real journey: scrolling a 4M-row CSV on the duckdb engine (#329)", async ({ page }) => {
  test.skip(!csv || !existsSync(csv), "DTK_BIG_CSV not set");
  test.setTimeout(280_000);
  mkdirSync(shots, { recursive: true });
  const ws: Workspace = {
    name: "big329",
    datasets: { train: { x: { kind: "csv", path: csv!, engine: "duckdb" } } },
    label: { mode: "order" },
    merges: [],
    variables: [],
    groups: [],
    steps: [],
  };
  const report: Record<string, number | string> = { serverBeforeMb: serverRssMb() };
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__DTK_DISPATCH__ === "function");
  report.browserBeforeMb = await heapMb(page);
  const t0 = Date.now();
  await page.evaluate((w) => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_WORKSPACE", workspace: w });
    d({ type: "SET_SCREEN", screen: "bench" });
  }, ws);
  await expect(page.locator(".grid-vbody")).toBeVisible({ timeout: 200_000 });
  const grid = page.getByLabel("Data grid");
  await expect(page.locator(".grid-vwindow .sk-grid-row")).toHaveCount(0, { timeout: 120_000 });
  report.firstRowsSec = (Date.now() - t0) / 1000;
  await expect(page.locator(".grid-vfooter-text")).toContainText("of 4,000,000");
  await page.screenshot({ path: join(shots, "big-top.png") });

  // Wheel scrolling from the top, then jumps across the file.
  const box = (await grid.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  let placeholderFrames = 0;
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 150);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 60)));
    if ((await page.locator(".grid-vwindow .sk-grid-row").count()) > 0) placeholderFrames++;
  }
  report.slowScrollFramesWithPlaceholders = placeholderFrames;
  const jumps: number[] = [];
  for (const f of [0.3, 0.5, 0.75, 0.99, 1, 0.1]) {
    const from = await page.locator(".grid-vbody").getAttribute("data-window");
    const t = Date.now();
    await grid.evaluate((e, x) => (e.scrollTop = (e.scrollHeight - e.clientHeight) * x), f);
    await expect(page.locator(".grid-vbody")).not.toHaveAttribute("data-window", from!);
    await expect(page.locator(".grid-vwindow .sk-grid-row")).toHaveCount(0, { timeout: 30_000 });
    jumps.push((Date.now() - t) / 1000);
    if (f === 0.5) await page.screenshot({ path: join(shots, "big-middle.png") });
    if (f === 1) await page.screenshot({ path: join(shots, "big-end.png") });
  }
  report.jumpSettleSec = jumps.join(" ");
  report.pagesInMemory = Number(await page.locator(".grid-vbody").getAttribute("data-pages"));
  report.browserAfterMb = await heapMb(page);
  report.serverAfterMb = serverRssMb();
  report.serverPeakMb = serverRssMb(true);
  console.log("JOURNEY " + JSON.stringify(report));
  expect(report.pagesInMemory).toBeLessThanOrEqual(24);
});
