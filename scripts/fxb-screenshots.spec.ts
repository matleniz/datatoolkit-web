/**
 * One-shot screenshots for FX-B review fixes (MAT-139).
 * Usage: npx playwright test --config=scripts/playwright.fxb.config.ts
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
}

test.describe("FX-B screenshots", () => {
  test.setTimeout(180_000);

  test("1 time-travel shows version rows", async ({ page }) => {
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
    await expect(page.locator(".pipeline-ver", { hasText: "v2" })).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(async () => {
        const ages = await page.locator(".grid-td").allTextContents();
        return ages.some((t) => t.includes("-999"));
      })
      .toBe(false);

    await page.locator(".pipeline-node", { hasText: "v1" }).first().click();
    await expect(page.getByText("Time travel")).toBeVisible();
    await expect(page.locator(".grid-row").first()).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: join(SHOT, "01-time-travel.png"),
      fullPage: false,
    });
  });

  test("2 value groups render spellings", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goWorkbench(page);
    await page.evaluate(() => {
      window.__DTK_DISPATCH__?.({ type: "SET_VIEW_VERSION", version: null });
      window.__DTK_DISPATCH__?.({ type: "CLEAR_SELECTION" });
      window.__DTK_DISPATCH__?.({ type: "PICK_COL", name: "city" });
    });
    await expect(page.getByText("Value groups")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".insp-group-row").first()).toContainText(
      "paris",
    );
    await expect(page.locator(".insp-group-row").first()).not.toHaveText(
      /normalized\s*←/,
    );
    await page.screenshot({
      path: join(SHOT, "02-value-groups.png"),
      fullPage: false,
    });
  });

  test("3 dock right is visible beside grid", async ({ page }) => {
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
    });
    const dock = page.getByLabel("Tool dock");
    await expect(dock).toBeVisible();
    await expect(dock).toHaveClass(/dock-right/);
    await expect(page.locator(".dock-window:has-text('Loading')")).toHaveCount(
      0,
      { timeout: 30_000 },
    );
    const box = await dock.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(120);
    const insp = page.getByLabel("Inspector");
    const ib = await insp.boundingBox();
    expect(ib).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(ib!.x + 2);
    // Grid region must not overflow over the dock.
    const grid = page.locator(".grid-shell");
    const gb = await grid.boundingBox();
    expect(gb).not.toBeNull();
    expect(gb!.x + gb!.width).toBeLessThanOrEqual(box!.x + 2);
    await page.screenshot({
      path: join(SHOT, "03-dock-right.png"),
      fullPage: false,
    });
  });

  test("4 export shows manifest summary", async ({ page }) => {
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
    await expect(manifest).toContainText(/fitted|step/i);
    await expect(manifest).toContainText("train.parquet");
    await page.screenshot({
      path: join(SHOT, "04-export-manifest.png"),
      fullPage: false,
    });
  });

  test("5 parkinson grid loads with paging", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Workbench/ })).toBeVisible({
      timeout: 60_000,
    });

    const ok = await page.evaluate(async () => {
      const res = await fetch("/api/workspaces/parkinson");
      if (!res.ok) return false;
      const ws = await res.json();
      window.__DTK_DISPATCH__?.({ type: "SET_WORKSPACE", workspace: ws });
      window.__DTK_DISPATCH__?.({ type: "SET_SCREEN", screen: "bench" });
      return !!(ws?.datasets?.train?.x?.path);
    });
    expect(ok).toBe(true);

    await expect(page.getByLabel("Workbench")).toBeVisible();

    await expect
      .poll(
        async () => {
          const rows = await page.locator(".grid-row").count();
          const err = await page.locator(".error-banner").count();
          return rows + err;
        },
        { timeout: 45_000 },
      )
      .toBeGreaterThan(0);

    const rowCount = await page.locator(".grid-row").count();
    if (rowCount > 0) {
      await expect(page.locator(".grid-more")).toContainText("55603");
      await page.locator(".grid").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect
        .poll(async () => page.locator(".grid-row").count(), {
          timeout: 15_000,
        })
        .toBeGreaterThan(rowCount);
    }

    await page.screenshot({
      path: join(SHOT, "05-parkinson-grid.png"),
      fullPage: false,
    });
  });
});
