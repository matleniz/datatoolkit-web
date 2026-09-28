import { expect, type Page } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Workspace } from "../src/api/types";

const here = dirname(fileURLToPath(import.meta.url));
export const e2eScreenshotsDir = join(here, "screenshots");
export const docsScreenshotsDir = join(here, "../docs/screenshots/t1-e2e");
export const fixturesDir = join(here, "fixtures");

/**
 * Delete prior e2e screenshots for a flow so a failed run never leaves stale PNGs.
 * Call at the start of each flow before the first capture.
 * (docs/screenshots are overwritten in place and left for the PR.)
 */
export function clearFlowScreenshots(flow: string): void {
  rmSync(join(e2eScreenshotsDir, flow), { recursive: true, force: true });
}

export async function captureFlowScreenshot(
  page: Page,
  flow: string,
  fileName: string,
): Promise<void> {
  // Never screenshot a loading state
  await expect(page.locator(".dock-window:has-text('Loading…')")).toHaveCount(0);
  await expect(page.getByText("Loading workspace…")).toBeHidden();
  const e2ePath = join(e2eScreenshotsDir, flow, fileName);
  const docsPath = join(docsScreenshotsDir, flow, fileName);
  mkdirSync(dirname(e2ePath), { recursive: true });
  mkdirSync(dirname(docsPath), { recursive: true });
  await page.screenshot({ path: e2ePath, fullPage: true });
  await page.screenshot({ path: docsPath, fullPage: true });
}

/**
 * Wait until the workbench grid is ready for a screenshot:
 * ≥1 data row, grid not loading rows, raw pipeline shape not "—".
 * Does not wait for Suggestions analysis (that can run after grid ready).
 */
export async function waitForGridReady(page: Page): Promise<void> {
  await expect(page.getByLabel("Data grid")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".grid-row").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(".grid-inline-loading")).toHaveCount(0, {
    timeout: 60_000,
  });
  await expect(
    page.locator(".grid-more", { hasText: /Loading rows/ }),
  ).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText("Loading workspace…")).toHaveCount(0);

  const rawNode = page
    .locator(".pipeline-node")
    .filter({ has: page.locator(".pipeline-ver", { hasText: /^raw$/ }) });
  await expect(rawNode).toBeVisible({ timeout: 30_000 });
  await expect(rawNode.locator(".pipeline-meta > span").first()).not.toHaveText(
    "—",
    { timeout: 60_000 },
  );
  await expect(rawNode.locator(".pipeline-meta > span").first()).toHaveText(
    /\d+\s*×\s*\d+/,
    { timeout: 60_000 },
  );
}

export function churnWorkspace(): Workspace {
  return {
    name: "churn",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "churn_train.csv") },
        y: { kind: "csv", path: join(fixturesDir, "churn_labels.csv") },
      },
      test: {
        x: {
          kind: "csv",
          path: join(fixturesDir, "churn_test.csv"),
          decimal: ",",
        },
      },
    },
    label: { mode: "order" },
    merges: [
      {
        source: {
          kind: "csv",
          path: join(fixturesDir, "customers_extra.csv"),
        },
        key: "customer_id",
        apply_to: "both",
      },
    ],
    variables: [],
    steps: [],
  };
}

/** Titanic demo (Survived on X as target_column) — MAT-147 distribution by. */
export function titanicWorkspace(): Workspace {
  return {
    name: "titanic",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "titanic_train.csv") },
        target_column: "Survived",
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

/** Partial-duplicate stations without auto identity columns (MAT-155 #1). */
export function stationsPartialWorkspace(): Workspace {
  return {
    name: "stations_partial",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "stations_partial.csv") },
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

/**
 * Adult-like train/test with trailing-dot income labels on test only
 * (MAT-155 item 6 / align_report value_mismatch).
 */
export function adultAlignWorkspace(): Workspace {
  return {
    name: "adult_align",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "adult_align_train.csv") },
        target_column: "income",
      },
      test: {
        x: { kind: "csv", path: join(fixturesDir, "adult_align_test.csv") },
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

/**
 * Titanic with Survived as a separate y file (label column renamed `target`
 * to match the Studio y-file convention used by targetColumnOf).
 */
export function titanicYFileWorkspace(): Workspace {
  return {
    name: "titanic_y",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "titanic_x.csv") },
        y: { kind: "csv", path: join(fixturesDir, "titanic_y.csv") },
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

/**
 * 60+ column train/test pair with mismatches at the bottom of the align report
 * (type mismatch, missing in test, extra in test). Used by scroll regression.
 */
export function wideAlignWorkspace(): Workspace {
  return {
    name: "wide_align",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "wide_align_train.csv") },
        y: { kind: "csv", path: join(fixturesDir, "wide_align_labels.csv") },
      },
      test: {
        x: { kind: "csv", path: join(fixturesDir, "wide_align_test.csv") },
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

/**
 * Open workbench and wait until grid data is loaded and suggestions analysis has completed.
 */
export async function openWorkbench(
  page: Page,
  reset = false,
): Promise<void> {
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });

  if (reset) {
    const ws = churnWorkspace();
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
  } else {
    await page.getByRole("button", { name: /Workbench/ }).click();
  }

  await expect(page.getByLabel("Workbench")).toBeVisible();
  await waitForGridReady(page);
  await expect(page.locator(".grid-th", { hasText: "age" })).toBeVisible({
    timeout: 30_000,
  });
  // Ensure suggestions have run and count is non-zero
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.__DTK_STATE__?.()?.sugCount ?? 0),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
}

/** Load a custom workspace into the workbench (e2e helpers for non-churn sets). */
export async function openWorkspaceBench(
  page: Page,
  workspace: Workspace,
  readyCol: string,
): Promise<void> {
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.__DTK_DISPATCH__ === "function",
  );
  await page.evaluate((ws) => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_WORKSPACE", workspace: ws });
    d({ type: "SET_SCREEN", screen: "bench" });
    d({ type: "CLEAR_SELECTION" });
    d({ type: "SET_DIST_BY", by: null });
  }, workspace);
  await page.waitForFunction(async () => {
    const p = window.__DTK_WORKSPACE_SAVED__;
    if (!p) return false;
    await p;
    return true;
  });
  await expect(page.getByLabel("Workbench")).toBeVisible();
  await waitForGridReady(page);
  await expect(page.locator(".grid-th", { hasText: readyCol })).toBeVisible({
    timeout: 30_000,
  });
}
