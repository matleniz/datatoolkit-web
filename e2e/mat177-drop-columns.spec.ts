import { expect, test } from "@playwright/test";

import {
  clearFlowScreenshots,
  captureFlowScreenshot,
  openWorkspaceBench,
  parkinsonLikeWorkspace,
  waitForGridReady,
} from "./helpers";

test("MAT-177: Drop columns editor on Parkinson-like — Columns field, already-gone, Apply", async ({
  page,
}) => {
  test.setTimeout(180_000);
  clearFlowScreenshots("mat177-drop-columns");
  await page.setViewportSize({ width: 1440, height: 900 });

  await openWorkspaceBench(page, parkinsonLikeWorkspace(), "Index");
  await waitForGridReady(page);

  // 1. Drop time_since_diagnosis from the context menu
  await page
    .getByRole("button", { name: "time_since_diagnosis, number" })
    .click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Column menu" })).toBeVisible();
  await page.getByRole("menuitem", { name: /Drop column/ }).click();
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(page.getByText("Columns", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("button", { name: "Columns: time_since_diagnosis" }),
  ).toHaveAttribute("aria-pressed", "true");
  const apply = page.getByRole("button", { name: "Apply step" }).first();
  await expect(apply).toBeEnabled({ timeout: 30_000 });
  await apply.click();
  await expect(page.getByLabel("Step editor")).toHaveCount(0, {
    timeout: 30_000,
  });
  await waitForGridReady(page);
  await expect(
    page.getByRole("button", { name: "time_since_diagnosis, number" }),
  ).toHaveCount(0);

  // 2. Second attempt to drop the same column → already gone (stale selection / re-open)
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({
      type: "OPEN_EDITOR",
      op: "drop_columns",
      params: { columns: ["time_since_diagnosis"] },
      target: "both",
    });
  });
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(page.getByText("Columns", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("alert")).toContainText(/already gone/i, {
    timeout: 15_000,
  });
  await expect(
    page.getByRole("button", { name: "Apply step" }).first(),
  ).toBeDisabled();
  await captureFlowScreenshot(page, "mat177-drop-columns", "01-already-gone.png");
  await page.getByRole("button", { name: "Discard" }).click();

  // 3. Select Index → Drop columns shows Columns=[Index], Apply works
  await page
    .getByRole("button", { name: /^Index,/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /Drop column/ }).click();
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(page.getByText("Columns", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("button", { name: "Columns: Index" }),
  ).toHaveAttribute("aria-pressed", "true");
  // Must not be the broken empty-params state
  await expect(page.locator("[data-ed-schema-error]")).toHaveCount(0);
  const applyIndex = page.getByRole("button", { name: "Apply step" }).first();
  await expect(applyIndex).toBeEnabled({ timeout: 30_000 });
  await captureFlowScreenshot(page, "mat177-drop-columns", "02-index-editor.png");
  await applyIndex.click();
  await expect(page.getByLabel("Step editor")).toHaveCount(0, {
    timeout: 30_000,
  });
  await waitForGridReady(page);
  await expect(page.getByRole("button", { name: /^Index,/ })).toHaveCount(0);
  await captureFlowScreenshot(page, "mat177-drop-columns", "03-after-index-drop.png");
});
