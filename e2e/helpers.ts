import { expect, type Locator, type Page } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Workspace } from "../src/api/types";

const here = dirname(fileURLToPath(import.meta.url));
const e2eScreenshotsDir = join(here, "screenshots");
const docsScreenshotsDir = join(here, "../docs/screenshots/t1-e2e");
export const fixturesDir = join(here, "fixtures");

/** Set DTK_E2E_SCREENSHOTS=1 to also refresh the committed PNGs under docs/screenshots. */
const writeDocsScreenshots = process.env.DTK_E2E_SCREENSHOTS === "1";

/**
 * Delete prior e2e screenshots for a flow so a failed run never leaves stale PNGs.
 * Call at the start of each flow before the first capture.
 * (docs/screenshots are only overwritten in place with DTK_E2E_SCREENSHOTS=1.)
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
  mkdirSync(dirname(e2ePath), { recursive: true });
  await page.screenshot({ path: e2ePath, fullPage: true });
  if (!writeDocsScreenshots) return;
  const docsPath = join(docsScreenshotsDir, flow, fileName);
  mkdirSync(dirname(docsPath), { recursive: true });
  await page.screenshot({ path: docsPath, fullPage: true });
}

/**
 * Wait until the workbench grid is ready for a screenshot:
 * rows loaded for the viewed identity (`data-identity` caught up with
 * `data-identity-current`, so not the previous version's rows), ≥1 data row,
 * grid not loading rows, raw pipeline shape not "—".
 * Does not wait for Suggestions analysis (that can run after grid ready).
 */
export async function waitForGridReady(page: Page): Promise<void> {
  const grid = page.getByLabel("Data grid");
  await expect(grid).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      async () => {
        const shown = await grid.getAttribute("data-identity");
        const current = await grid.getAttribute("data-identity-current");
        return !!shown && shown === current;
      },
      { timeout: 60_000, message: "grid rows loaded for the viewed identity" },
    )
    .toBe(true);
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

/**
 * Wait until the Alignment screen shows the report for the current fixes
 * (`data-align-state`, #13): every fix starts a new report, and a cold engine
 * can take well over the 5 s default to answer.
 */
export async function waitForAlignReady(page: Page): Promise<void> {
  await expect(page.locator(".align-layout")).toHaveAttribute(
    "data-align-state",
    "ready",
    { timeout: 90_000 },
  );
}

/**
 * Wait until Suggestions settled for the identity being viewed (the cards'
 * `data-identity` caught up with `data-identity-current`, #13). On a cold
 * analysis cache a large frame takes longer than any fixed count poll.
 */
export async function waitForSuggestionsReady(page: Page): Promise<void> {
  const strip = page.locator(".sug-identity");
  await expect
    .poll(
      async () => {
        const shown = await strip.getAttribute("data-identity");
        const current = await strip.getAttribute("data-identity-current");
        return !!shown && shown === current;
      },
      { timeout: 180_000, message: "Suggestions settled for the viewed identity" },
    )
    .toBe(true);
}

/** Suggestions settled for the viewed identity and flagged something. */
export async function expectSuggestions(page: Page): Promise<void> {
  await waitForSuggestionsReady(page);
  expect(
    await page.evaluate(() => window.__DTK_STATE__?.()?.sugCount ?? 0),
    "suggestions count",
  ).toBeGreaterThan(0);
}

/**
 * Click the step editor's Apply, then wait for the step to be in the pipeline
 * with its shape computed (#13): the editor closes on ADD_STEP, the grid
 * reloads, and the node's shape is filled once the version replayed.
 */
export async function applyEditorStep(
  page: Page,
  nodeTitle: string,
): Promise<Locator> {
  const apply = page.getByRole("button", { name: "Apply step" }).first();
  await expect(apply).toBeEnabled({ timeout: 60_000 });
  await apply.click();
  await expect(page.getByLabel("Step editor")).toBeHidden({ timeout: 15_000 });
  await waitForGridReady(page);
  const node = page.locator(".pipeline-node", { hasText: nodeTitle }).first();
  await expect(node).toBeVisible();
  await expect(node.locator(".pipeline-shape")).toHaveText(/\d+\s*×\s*\d+/, {
    timeout: 60_000,
  });
  return node;
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

/** Chipotle-like prices with currency-as-text (MAT-160). */
export function chipotlePricesWorkspace(): Workspace {
  return {
    name: "chipotle_prices",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "chipotle_prices.csv") },
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

/** Messy survey sites with hyphen/underscore/space variants (MAT-160). */
export function messySurveyWorkspace(): Workspace {
  return {
    name: "messy_survey",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "messy_survey.csv") },
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

/** Train/test with a 70%-missing column for drop_high_missing (MAT-160). */
export function highMissingWorkspace(): Workspace {
  return {
    name: "high_missing",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "high_missing_train.csv") },
        target_column: "target",
      },
      test: {
        x: { kind: "csv", path: join(fixturesDir, "high_missing_test.csv") },
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

/** Parkinson-like train X + y (+ optional test): 13 X cols, separate y (MAT-177). */
export function parkinsonLikeWorkspace(): Workspace {
  return {
    name: "parkinson_like",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "parkinson_like_x.csv") },
        y: { kind: "csv", path: join(fixturesDir, "parkinson_like_y.csv") },
      },
      test: {
        x: { kind: "csv", path: join(fixturesDir, "parkinson_like_test.csv") },
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

/**
 * 120 patients x 3 visits, bmi missing at visit 2 for one patient in four:
 * `patient_id` is the engine's `group_id` column (datatoolkit-issues#48).
 */
export function patientsVisitsWorkspace(): Workspace {
  return {
    name: "patients_visits",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixturesDir, "patients_visits.csv") },
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

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
  await expect(page.getByRole("button", { name: "age, number" })).toBeVisible({
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

/**
 * Open an analysis window's Details drawer (MAT-235): metrics and tables
 * live there, collapsed, under the figure. No-op when already open.
 */
export async function openDetails(win: Locator): Promise<void> {
  const toggle = win.locator(".result-details-toggle");
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/**
 * Expand a window's Parameters panel (collapsed to a one-line summary by
 * default since MAT-235). No-op when already open.
 */
export async function openParams(win: Locator): Promise<void> {
  const toggle = win.locator("[data-dock-params-toggle]");
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** The source-file input (not the documents one): both live on the Sources screen. */
export function sourceFileInput(page: Page): Locator {
  return page.getByLabel(/Add a file/);
}
