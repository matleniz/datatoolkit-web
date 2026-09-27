import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Workspace } from "../src/api/types";

const here = dirname(fileURLToPath(import.meta.url));
const shotDir = join(here, "screenshots/tools");
const docsDir = join(here, "../docs/screenshots/w3-panels-dock");
const fixtures = join(here, "fixtures");

function churnWorkspace(): Workspace {
  return {
    name: "churn",
    datasets: {
      train: {
        x: { kind: "csv", path: join(fixtures, "churn_train.csv") },
        y: { kind: "csv", path: join(fixtures, "churn_labels.csv") },
      },
      test: {
        x: {
          kind: "csv",
          path: join(fixtures, "churn_test.csv"),
          decimal: ",",
        },
      },
    },
    label: { mode: "order" },
    merges: [
      {
        source: { kind: "csv", path: join(fixtures, "customers_extra.csv") },
        key: "customer_id",
        apply_to: "both",
      },
    ],
    variables: [],
    steps: [],
  };
}

test.describe("W3 tools / dock / export", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    mkdirSync(shotDir, { recursive: true });
    mkdirSync(docsDir, { recursive: true });
    await page.goto("/");
    await page.getByRole("button", { name: /Workbench/ }).click();
    await expect(page.getByLabel("Workbench")).toBeVisible();

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
    // App auto-saves; wait until the engine store has the workspace.
    await page.waitForFunction(async () => {
      const p = window.__DTK_WORKSPACE_SAVED__;
      if (!p) return false;
      await p;
      return true;
    });
  });

  test("create variable, dock windows, export", async ({ page }) => {
    // Suggestions badge must reflect real analysis-key findings.
    await expect
      .poll(async () =>
        page.evaluate(() => window.__DTK_STATE__!().sugCount),
      )
      .toBeGreaterThan(0);
    await expect(
      page.getByRole("tab", { name: /Suggestions · [1-9]/ }),
    ).toBeVisible();

    await page.getByRole("tab", { name: /Suggestions/ }).click();
    await expect(page.locator(".sug-card").first()).toBeVisible({
      timeout: 30_000,
    });
    const sugText = await page.locator(".sug-list").innerText();
    expect(sugText.toLowerCase()).toMatch(/duplicate/);
    expect(sugText).toMatch(/-999/);

    await page.getByRole("tab", { name: /Variables/ }).click();
    await page.getByRole("button", { name: "median", exact: true }).click();
    await page
      .getByRole("button", { name: "monthly_spend", exact: true })
      .click();
    await page.locator("#nv-name").fill("spend_med");
    await page.getByRole("button", { name: "Add variable" }).click();
    await expect(page.getByText("@spend_med")).toBeVisible({
      timeout: 15_000,
    });

    await page.screenshot({
      path: join(shotDir, "01-variable.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: join(docsDir, "01-variable.png"),
      fullPage: true,
    });

    // Correlation with nothing selected → all numeric columns (≥ 4×4).
    await page.evaluate(() => {
      window.__DTK_DISPATCH__!({ type: "CLEAR_SELECTION" });
    });
    await page.getByRole("button", { name: "Correlation matrix" }).click();
    await expect(page.locator('[data-tool="corr"]')).toBeVisible();
    await expect(page.locator('[data-tool="corr"] [data-corr-size]')).toBeVisible({
      timeout: 20_000,
    });
    const corrSize = Number(
      await page
        .locator('[data-tool="corr"] [data-corr-size]')
        .getAttribute("data-corr-size"),
    );
    expect(corrSize).toBeGreaterThanOrEqual(4);
    await expect(
      page.locator('[data-tool="corr"] [data-corr-matrix] .matrix-cell'),
    ).toHaveCount(corrSize * corrSize);

    // Compare age + sessions with mean values.
    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "age" });
      d({ type: "PICK_COL", name: "sessions", add: true });
    });
    await page.getByRole("button", { name: "Compare columns" }).click();
    await expect(page.locator('[data-tool="compare"]')).toBeVisible();
    await expect(
      page.locator('[data-tool="compare"] [data-compare-cols]'),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator(
        '[data-tool="compare"] [data-stat="mean"][data-col="age"]',
      ),
    ).not.toHaveText(/^[–—∅]?$/);
    await expect(
      page.locator(
        '[data-tool="compare"] [data-stat="mean"][data-col="sessions"]',
      ),
    ).not.toHaveText(/^[–—∅]?$/);
    const ageMean = await page
      .locator('[data-tool="compare"] [data-stat="mean"][data-col="age"]')
      .innerText();
    const sessionsMean = await page
      .locator(
        '[data-tool="compare"] [data-stat="mean"][data-col="sessions"]',
      )
      .innerText();
    expect(Number(ageMean)).toBeGreaterThan(0);
    expect(Number(sessionsMean)).toBeGreaterThan(0);

    await page.screenshot({
      path: join(shotDir, "02-compare-corr.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: join(docsDir, "02-compare-corr.png"),
      fullPage: true,
    });

    const corrBar = page.locator('[data-tool="corr"] [data-drag="1"]');
    const compareBar = page.locator('[data-tool="compare"] [data-drag="1"]');
    await corrBar.dragTo(compareBar);
    await expect
      .poll(async () =>
        page.evaluate(() => window.__DTK_STATE__!().dock.tools[0]),
      )
      .toBe("corr");

    await page
      .getByRole("group", { name: "Dock position" })
      .getByRole("button", { name: "Right" })
      .click();
    await expect
      .poll(async () => page.evaluate(() => window.__DTK_STATE__!().dock.pos))
      .toBe("right");

    await page.screenshot({
      path: join(shotDir, "03-dock-right.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: join(docsDir, "03-dock-right.png"),
      fullPage: true,
    });

    await page
      .locator('[data-tool="compare"]')
      .getByRole("button", { name: "Maximize or restore" })
      .click();
    await expect
      .poll(async () =>
        page.evaluate(() => window.__DTK_STATE__!().dock.maximized),
      )
      .toBe("compare");

    await page.screenshot({
      path: join(shotDir, "04-maximized.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: join(docsDir, "04-maximized.png"),
      fullPage: true,
    });

    await page
      .locator('[data-tool="compare"]')
      .getByRole("button", { name: "Maximize or restore" })
      .click();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByLabel("Export")).toBeVisible();
    await page.getByLabel("Output directory").fill("/tmp/dtk-export-e2e");
    await page
      .getByRole("button", { name: "Export parquet + manifest" })
      .click();

    await page.screenshot({
      path: join(shotDir, "05-export.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: join(docsDir, "05-export.png"),
      fullPage: true,
    });
  });
});
