import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkbench,
  waitForGridReady,
} from "./helpers";

test.describe("MAT-233 Transform entry in Workbench tool rail", () => {
  test("Transform button opens picker, toggles closed, and prefills step editor with column selection", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    clearFlowScreenshots("mat233-rail-transform");
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Open workbench
    await openWorkbench(page, true);
    await waitForGridReady(page);

    const rail = page.getByRole("navigation", { name: "Analysis tools" });
    const transformBtn = rail.getByRole("button", { name: "Transform", exact: true });

    // 2. Verify Transform button exists in the tool rail and starts unpressed
    await expect(transformBtn).toBeVisible();
    await expect(transformBtn).toHaveAttribute("aria-pressed", "false");

    // 3. Click Transform in rail without selection -> opens step picker
    await transformBtn.click();
    const editor = page.getByLabel("Step editor");
    await expect(editor).toBeVisible();
    await expect(editor.getByText("Add a step")).toBeVisible();
    await expect(
      editor.getByText("Pick a transform. You set every parameter before anything is applied."),
    ).toBeVisible();
    await expect(transformBtn).toHaveAttribute("aria-pressed", "true");

    // Capture screenshot: step picker opened from rail
    await captureFlowScreenshot(
      page,
      "mat233-rail-transform",
      "01-rail-transform-picker.png",
    );

    // 4. Click Transform in rail again -> toggles picker closed
    await transformBtn.click();
    await expect(page.getByLabel("Step editor")).toHaveCount(0);
    await expect(transformBtn).toHaveAttribute("aria-pressed", "false");

    // 5. Select a single numeric column ('age') in the grid
    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "age" });
    });

    // 6. Click Transform in rail -> opens picker
    await transformBtn.click();
    await expect(editor).toBeVisible();
    await expect(transformBtn).toHaveAttribute("aria-pressed", "true");

    // Click 'Impute' transform
    const imputeOp = editor.getByRole("button", { name: "Impute", exact: true });
    await expect(imputeOp).toBeVisible();
    await imputeOp.click();

    // Verify step editor opens with 'age' prefilled
    await expect(editor.locator(".ed-title")).toHaveText("Impute");
    await expect(
      editor.getByRole("button", { name: "Columns: age", pressed: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(transformBtn).toHaveAttribute("aria-pressed", "true");

    // Capture screenshot: step editor prefilled with selected column
    await captureFlowScreenshot(
      page,
      "mat233-rail-transform",
      "02-rail-transform-prefilled-column.png",
    );

    // Cancel out of editor
    await editor.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByLabel("Step editor")).toHaveCount(0);
    await expect(transformBtn).toHaveAttribute("aria-pressed", "false");

    // 7. Multi-column selection ('monthly_spend' + 'sessions')
    await page.evaluate(() => {
      const d = window.__DTK_DISPATCH__!;
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "monthly_spend" });
      d({ type: "PICK_COL", name: "sessions", add: true });
    });

    // Click Transform in rail -> opens picker
    await transformBtn.click();
    await expect(editor).toBeVisible();

    // Click 'Scale' transform
    const scaleOp = editor.getByRole("button", { name: "Scale" });
    await expect(scaleOp).toBeVisible();
    await scaleOp.click();

    // Verify step editor opens with both columns prefilled
    await expect(editor.locator(".ed-title")).toHaveText("Scale");
    await expect(
      editor.getByRole("button", { name: "Columns: monthly_spend", pressed: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      editor.getByRole("button", { name: "Columns: sessions", pressed: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Capture screenshot: multi-column step editor prefilled
    await captureFlowScreenshot(
      page,
      "mat233-rail-transform",
      "03-rail-transform-multi-columns.png",
    );
  });
});
