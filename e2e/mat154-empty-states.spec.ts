import { expect, test, type Page } from "@playwright/test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EMPTY_DATA_ROWS_MSG,
  TEXT_PREVIEW_CHARS,
} from "../src/bench/format";
import { fixturesDir } from "./helpers";

const HEADER_ONLY = join(fixturesDir, "adv_header_only.csv");
const VERY_LONG = join(fixturesDir, "adv_very_long_strings.csv");

async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "+ New workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(`Sources of “${name}”`)).toBeVisible({
    timeout: 15_000,
  });
}

async function uploadAsTrainX(
  page: Page,
  filePath: string,
  fileName: string,
): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(filePath);
  const filesList = page.getByRole("region", { name: "Files list" });
  const row = filesList.locator(".files-table-block, .files-table-row", {
    hasText: fileName,
  });
  await expect(row.first()).toBeVisible({ timeout: 30_000 });
  await row.first().getByRole("button", { name: /Train X/ }).click();
  await expect(
    row.first().getByRole("button", { name: /Train X/ }),
  ).toHaveAttribute("aria-pressed", "true");
}

async function waitHeaderOnlyReady(page: Page): Promise<void> {
  await expect(page.getByLabel("Data grid")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".grid-th").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(".grid-inline-loading")).toHaveCount(0, {
    timeout: 60_000,
  });
  await expect(
    page.locator(".grid-more", { hasText: /Loading rows/ }),
  ).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText("Loading workspace…")).toHaveCount(0);
}

/**
 * MAT-154 item 2: header-only CSV (0 data rows) shows an explicit empty state
 * on the grid and in analysis dock windows (Distribution).
 */
test("MAT-154: header-only CSV shows empty state in grid and Distribution", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await createWorkspace(page, "adv_header_only_wb");
  await uploadAsTrainX(page, HEADER_ONLY, "adv_header_only.csv");

  await page.getByRole("button", { name: "Open workbench" }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible({ timeout: 30_000 });
  await waitHeaderOnlyReady(page);

  const empty = page.getByLabel(EMPTY_DATA_ROWS_MSG);
  await expect(empty).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".grid-row")).toHaveCount(0);

  // Distribution must not paint blank axes — same empty-state copy.
  await page.locator(".grid-th").first().click();
  await page
    .getByRole("navigation", { name: "Analysis tools" })
    .getByRole("button", { name: "Distribution" })
    .click();
  const dock = page.locator('.dock-window[data-tool="dist"]');
  await expect(dock).toBeVisible({ timeout: 30_000 });
  await expect(dock.locator('[data-empty-rows="1"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(dock.getByText(EMPTY_DATA_ROWS_MSG)).toBeVisible();
  // No plotly canvas / hist bars for an empty frame.
  await expect(dock.locator(".hist-bars")).toHaveCount(0);
  await expect(dock.locator(".js-plotly-plot")).toHaveCount(0);
});

/**
 * MAT-154 item 3: 50 000-char cell is truncated in the inspector with a
 * "Show full text" toggle (grid cell text is also truncated).
 */
test("MAT-154: very long cell truncates in inspector with Show full text", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await createWorkspace(page, "adv_longstr_wb");
  await uploadAsTrainX(page, VERY_LONG, "adv_very_long_strings.csv");

  await page.getByRole("button", { name: "Open workbench" }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".grid-row").first()).toBeVisible({
    timeout: 60_000,
  });

  // Click the huge_text cell (3rd data column).
  const hugeHeader = page.locator(".grid-th", { hasText: "huge_text" });
  await expect(hugeHeader).toBeVisible({ timeout: 30_000 });
  const cell = page.locator(".grid-row").first().locator(".grid-td").nth(2);
  await cell.click();

  const inspector = page.getByLabel("Inspector");
  await expect(inspector).toBeVisible();
  const value = inspector.locator(".insp-cell-value").first();
  await expect(value).toHaveAttribute("data-truncated", "1");
  await expect(value).toHaveAttribute("data-full-len", "50000");
  const previewLen = (await value.innerText()).length;
  // Quoted + ellipsis around a 500-char preview.
  expect(previewLen).toBeLessThan(TEXT_PREVIEW_CHARS + 10);
  expect(previewLen).toBeGreaterThan(TEXT_PREVIEW_CHARS);

  const toggle = inspector.getByRole("button", { name: "Show full text" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(
    inspector.getByRole("button", { name: "Show less" }),
  ).toBeVisible();
  await expect(value).toHaveAttribute("data-truncated", "0");
  // Full text is in a capped scroll box — still reachable.
  await expect(value).toHaveClass(/insp-cell-value-full/);
  expect((await value.innerText()).length).toBeGreaterThan(49_000);

  // Grid cell must not materialise the full string either.
  const cellText = await cell.innerText();
  expect(cellText.length).toBeLessThan(TEXT_PREVIEW_CHARS + 5);
});

/**
 * MAT-145 residual: Export outputs list scrolls at 1280×720.
 */
test("MAT-145: Export outputs list is scrollable at 1280x720", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });

  await createWorkspace(page, "export_scroll_wb");
  await uploadAsTrainX(page, VERY_LONG, "adv_very_long_strings.csv");

  await page.getByRole("button", { name: "Open workbench" }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".grid-row").first()).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const panel = page.getByLabel("Export", { exact: true });
  await expect(panel).toBeVisible();

  const scroll = page.locator('[data-export-scroll="1"]');
  await expect(scroll).toBeVisible();

  const beforeExport = await scroll.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return {
      overflowY: style.overflowY,
      hasScrollContainer:
        style.overflowY === "auto" || style.overflowY === "scroll",
    };
  });
  expect(beforeExport.hasScrollContainer).toBe(true);

  const outDir = join(tmpdir(), `dtk-e2e-export-scroll-${Date.now()}`);
  try {
    await page.getByLabel("Output directory").fill(outDir);
    await page.getByRole("button", { name: "Export parquet + manifest" }).click();
    await expect(page.getByLabel("Export manifest")).toBeVisible({
      timeout: 30_000,
    });

    const after = await scroll.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const before = el.scrollTop;
      el.scrollTop = el.scrollHeight;
      return {
        overflowY: style.overflowY,
        hasScrollContainer:
          style.overflowY === "auto" || style.overflowY === "scroll",
        canScroll: el.scrollHeight > el.clientHeight + 1,
        scrollDelta: el.scrollTop - before,
      };
    });
    expect(after.hasScrollContainer).toBe(true);
    expect(after.canScroll).toBe(true);
    expect(after.scrollDelta).toBeGreaterThan(0);
  } finally {
    if (process.env.DTK_E2E_KEEP !== "1") {
      rmSync(outDir, { recursive: true, force: true });
    }
  }
});
