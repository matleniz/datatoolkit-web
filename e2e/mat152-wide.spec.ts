import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import type { Workspace } from "../src/api/types";
import {
  clearFlowScreenshots,
  captureFlowScreenshot,
  fixturesDir,
  waitForGridReady,
} from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));

function wideWorkspace(): Workspace {
  return {
    name: "wide_320_e2e",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "wide_320_cols.csv") },
        target_column: "target",
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

function amesWorkspace(): Workspace {
  return {
    name: "ames_e2e",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "ames_housing.csv") },
        target_column: "SalePrice",
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

async function loadWorkspace(page: import("@playwright/test").Page, ws: Workspace) {
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.__DTK_DISPATCH__ === "function",
  );
  await page.evaluate((workspace) => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_WORKSPACE", workspace });
    d({ type: "SET_SCREEN", screen: "bench" });
    d({ type: "CLEAR_SELECTION" });
  }, ws);
  await page.waitForFunction(async () => {
    const p = window.__DTK_WORKSPACE_SAVED__;
    if (!p) return false;
    await p;
    return true;
  });
  await expect(page.getByLabel("Workbench")).toBeVisible();
}

test.describe("MAT-152 wide datasets", () => {
  test("workbench ready under 8s on 320+ columns with windowed headers", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    clearFlowScreenshots("mat152-wide");
    await page.setViewportSize({ width: 1440, height: 900 });

    const t0 = Date.now();
    await loadWorkspace(page, wideWorkspace());
    await waitForGridReady(page);
    const readyMs = Date.now() - t0;

    // Grid paints with a horizontal column window, not 320 header cells.
    const win = page.getByLabel("Data grid");
    await expect(win).toHaveAttribute("data-col-window", /\/320$/);
    const attr = await win.getAttribute("data-col-window");
    // e.g. "0:18/320"
    const m = attr?.match(/^(\d+):(\d+)\/(\d+)$/);
    expect(m).toBeTruthy();
    const start = Number(m![1]);
    const end = Number(m![2]);
    expect(end - start).toBeLessThan(40);
    expect(end - start).toBeGreaterThan(4);

    const thCount = await page.locator(".grid-th").count();
    expect(thCount).toBeLessThan(40);
    expect(thCount).toBe(end - start);

    expect(readyMs).toBeLessThan(8_000);

    await captureFlowScreenshot(page, "mat152-wide", "01-ready.png");
  });

  test("Ames-like: impute, scale, one-hot, then Export", async ({ page }) => {
    test.setTimeout(240_000);
    clearFlowScreenshots("mat152-ames");
    await page.setViewportSize({ width: 1440, height: 900 });

    await loadWorkspace(page, amesWorkspace());
    await waitForGridReady(page);

    // Open a couple of analysis docks (QA had several open when Export failed).
    await page
      .getByRole("navigation", { name: "Analysis tools" })
      .getByRole("button", { name: "Distribution" })
      .click();
    await page
      .getByRole("navigation", { name: "Analysis tools" })
      .getByRole("button", { name: "Missing values" })
      .click();

    async function applyOp(
      col: string,
      menuItem: string,
      opts?: { waitPreview?: boolean },
    ) {
      // Scroll the named header into view via programmatic pick + scrollIntoView
      // when the column is outside the window.
      await page.evaluate((name) => {
        const d = window.__DTK_DISPATCH__!;
        d({ type: "CLEAR_SELECTION" });
        d({ type: "PICK_COL", name });
      }, col);

      // Open context menu via dispatch coords near grid (editor path is more
      // reliable than right-click on an off-screen header).
      await page.evaluate((name) => {
        const d = window.__DTK_DISPATCH__!;
        d({ type: "OPEN_CTX", col: name, x: 400, y: 280 });
      }, col);
      await page.getByRole("menuitem", { name: menuItem }).click();
      await expect(page.getByLabel("Step editor")).toBeVisible({
        timeout: 30_000,
      });
      if (opts?.waitPreview !== false) {
        await expect(
          page.getByRole("status").filter({ hasText: /Live preview/i }),
        ).toBeVisible({ timeout: 60_000 });
      }
      // Prefer the banner Apply (always visible) so dock clutter cannot hide it.
      const apply = page
        .getByRole("status")
        .filter({ hasText: /Live preview/i })
        .getByRole("button", { name: "Apply step" });
      await expect(apply).toBeEnabled({ timeout: 60_000 });
      await apply.click({ timeout: 15_000 });
      await expect(page.getByLabel("Step editor")).toHaveCount(0, {
        timeout: 60_000,
      });
      await expect(
        page.locator(".pipeline-pending-kicker", { hasText: /Editing/i }),
      ).toHaveCount(0, { timeout: 30_000 });
      await waitForGridReady(page);
    }

    await applyOp("LotFrontage", "Impute…");
    await applyOp("LotArea", "Scale…");
    await applyOp("Neighborhood", "One-hot…");

    // Export must be clickable immediately after Apply (QA: 60s intercept).
    const exportBtn = page.getByRole("button", { name: "Export", exact: true });
    await expect(exportBtn).toBeVisible();
    await exportBtn.click({ timeout: 10_000 });
    await expect(page.getByLabel("Export")).toBeVisible({ timeout: 15_000 });

    const outDir = join(here, "screenshots", "mat152-ames", "export-out");
    await page.locator("#export-outdir").fill(outDir);
    await page
      .getByRole("button", { name: /Export parquet \+ manifest/i })
      .click();
    await expect(page.getByLabel("Export manifest")).toBeVisible({
      timeout: 60_000,
    });

    await captureFlowScreenshot(page, "mat152-ames", "01-exported.png");
  });
});
