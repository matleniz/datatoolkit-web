/**
 * One-shot screenshots for FX-B MAT-142 review fixes.
 * Usage: start dtk-api + vite on 5174, then
 *   npx playwright test --config=scripts/playwright.fxb.config.ts
 */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SHOT = join(process.cwd(), "docs/screenshots/fx-b");
mkdirSync(SHOT, { recursive: true });

async function goWorkbench(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Workbench/ })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".grid-row").first()).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText("Loading rows…")).toHaveCount(0, {
    timeout: 30_000,
  });
}

async function waitShapes(page: import("@playwright/test").Page, minNodes = 1) {
  await expect
    .poll(async () => {
      const shapes = await page.locator(".pipeline-shape").allTextContents();
      const ready = shapes.filter((t) => /\d+\s*×\s*\d+/.test(t));
      return ready.length >= minNodes && !shapes.some((t) => t === "…" || t === "—");
    }, { timeout: 60_000 })
    .toBe(true);
}

test.describe("FX-B MAT-142 screenshots", () => {
  test.setTimeout(180_000);

  test("1 shapes survive time travel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goWorkbench(page);

    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({
        type: "SET_STEPS",
        steps: [
          {
            op: "replace_sentinels",
            target: "both",
            params: { sentinels: { age: [-999] } },
          },
          {
            op: "impute",
            target: "both",
            params: { columns: ["age"], strategy: "median" },
          },
        ],
      });
    });
    await waitShapes(page, 3);
    await expect(page.locator(".pipeline-ver", { hasText: "v2" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(".grid-row").first()).toBeVisible({
      timeout: 30_000,
    });

    const shapeBefore = await page
      .locator(".pipeline-node", { hasText: "v1" })
      .locator(".pipeline-shape")
      .innerText();
    expect(shapeBefore).toMatch(/\d+\s*×\s*\d+/);

    await page.locator(".pipeline-node", { hasText: "v1" }).first().click();
    await expect(page.getByText("Time travel")).toBeVisible();
    await expect(page.locator(".grid-row").first()).toBeVisible({
      timeout: 15_000,
    });
    // Shapes must still be numeric — not "—".
    await expect(
      page.locator(".pipeline-node", { hasText: "v1" }).locator(".pipeline-shape"),
    ).toHaveText(/\d+\s*×\s*\d+/);
    await page.screenshot({
      path: join(SHOT, "01-time-travel.png"),
      fullPage: false,
    });
  });

  test("2 replace sentinels preview colours cells", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goWorkbench(page);
    // Clear any steps left on the saved workspace so age still has -999.
    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "SET_STEPS", steps: [] });
      d({ type: "SET_VIEW_VERSION", version: null });
    });
    await waitShapes(page, 1);
    await expect(page.locator(".grid-row").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "age" });
      d({
        type: "OPEN_EDITOR",
        op: "replace_sentinels",
        params: { sentinels: { age: [-999] } },
      });
    });
    await expect(page.getByLabel("Step editor")).toBeVisible();
    await expect(page.locator(".banner-delta")).toContainText(/2 cells? changed/i, {
      timeout: 30_000,
    });
    await expect(page.locator(".grid-td.tone-changed").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel("Step editor")).toContainText(
      "Not fitted: nothing is learned on train",
    );
    await expect(page.locator(".preview-banner .banner-code")).toContainText(
      "Replace sentinels",
    );
    await expect(page.locator(".preview-banner .banner-code")).not.toContainText(
      '{"op"',
    );
    await page.screenshot({
      path: join(SHOT, "07-replace-sentinels-preview.png"),
      fullPage: false,
    });
  });

  test("3 dock right at M leaves grid ≥50%", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goWorkbench(page);
    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "age" });
      d({ type: "PICK_COL", name: "sessions", add: true });
      d({ type: "OPEN_TOOL", id: "compare" });
      d({ type: "OPEN_TOOL", id: "corr" });
      d({ type: "SET_DOCK_POS", pos: "right" });
      d({ type: "SET_DOCK_SIZE", size: "M" });
    });
    const dock = page.getByLabel("Tool dock");
    await expect(dock).toBeVisible();
    await expect(dock).toHaveClass(/dock-right/);
    const grid = page.locator(".grid-shell");
    const gb = await grid.boundingBox();
    const db = await dock.boundingBox();
    expect(gb).not.toBeNull();
    expect(db).not.toBeNull();
    const centre = gb!.width + db!.width;
    expect(gb!.width / centre).toBeGreaterThanOrEqual(0.48);
    expect(db!.width).toBeLessThanOrEqual(440 + 2);
    await page.screenshot({
      path: join(SHOT, "03-dock-right.png"),
      fullPage: false,
    });
  });

  test("4 export panel shows full paths", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goWorkbench(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const outDir = join(tmpdir(), `fxb-export-${Date.now()}`);
    await page.getByLabel("Output directory").fill(outDir);
    await page
      .getByRole("button", { name: "Export parquet + manifest" })
      .click();
    const manifest = page.getByLabel("Export manifest");
    await expect(manifest).toBeVisible({ timeout: 30_000 });
    await expect(manifest).toContainText("train.parquet");
    await expect(manifest).toContainText("manifest:");
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    await page.screenshot({
      path: join(SHOT, "04-export-manifest.png"),
      fullPage: false,
    });
  });

  test("5 pipeline node layout with align badge", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goWorkbench(page);
    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({
        type: "SET_STEPS",
        steps: [
          {
            op: "rename",
            target: "test",
            align: true,
            params: { mapping: { nb_support_calls: "support_calls" } },
          },
          {
            op: "replace_sentinels",
            target: "both",
            params: { sentinels: { age: [-999] } },
          },
        ],
      });
    });
    await waitShapes(page, 3);
    const alignNode = page.locator(".pipeline-node", { hasText: "v1" }).first();
    await expect(alignNode.locator(".pipeline-badge")).toContainText("align");
    await expect(alignNode.locator(".pipeline-shape")).toHaveText(/\d+\s*×\s*\d+/);
    // Shape must be a single line (no wrap → height of the shape span stays small).
    const shapeBox = await alignNode.locator(".pipeline-shape").boundingBox();
    expect(shapeBox).not.toBeNull();
    expect(shapeBox!.height).toBeLessThan(20);
    await page.screenshot({
      path: join(SHOT, "08-pipeline-node-layout.png"),
      fullPage: false,
    });
  });
});
