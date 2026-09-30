import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkspaceBench,
  titanicWorkspace,
  waitForGridReady,
} from "./helpers";

const FLOW = "mat241-formula-python";

test.describe("MAT-241 python-style formulas", () => {
  test("'1 if Age < 18 else 0' → preview, apply, column; engine error inline", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    clearFlowScreenshots(FLOW);
    await page.setViewportSize({ width: 1440, height: 900 });

    await openWorkspaceBench(page, titanicWorkspace(), "Age");
    await waitForGridReady(page);

    await page.evaluate(() => {
      const w = window as unknown as {
        __DTK_DISPATCH__?: (a: unknown) => void;
      };
      const d = w.__DTK_DISPATCH__;
      if (!d) throw new Error("no dispatch");
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "Age" });
      d({ type: "PICK_COL", name: "Fare", add: true });
    });
    await page.getByRole("button", { name: "New feature…" }).click();
    await expect(page.locator("[data-formula-editor]")).toBeVisible();

    // Palette: numpy form in the help + Python section.
    await expect(
      page.locator("[data-formula-func-palette] .tiny-chip", {
        hasText: /^log1p$/,
      }),
    ).toHaveAttribute("title", /log1p\(x\) · np\.log1p\(x\)/);
    await expect(
      page.locator("[data-formula-py-palette] .tiny-chip", {
        hasText: "1 if Age < 18 else 0",
      }),
    ).toBeVisible();

    await page.getByLabel("Step editor").getByLabel("Name").fill("is_minor");
    await page.getByLabel("Expression").fill("1 if Age < 18 else 0");
    await expect(page.locator(".formula-status.ok")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator(".grid-th.added", { hasText: "is_minor" }),
    ).toBeVisible({ timeout: 15_000 });
    await captureFlowScreenshot(page, FLOW, "01-preview-if-else.png");

    const applyBtn = page.getByRole("button", { name: "Apply step" }).first();
    await expect(applyBtn).toBeEnabled();
    await applyBtn.click();
    await expect(
      page.locator(".pipeline-node", { hasText: "Formula" }),
    ).toBeVisible({ timeout: 15_000 });
    await waitForGridReady(page);
    await expect(
      page.locator(".grid-th", { hasText: "is_minor" }),
    ).toBeVisible();
    await captureFlowScreenshot(page, FLOW, "02-applied-column.png");

    // Second feature: unsupported construct → engine message verbatim.
    await page.getByRole("button", { name: "New feature…" }).first().click();
    await expect(page.locator("[data-formula-editor]")).toBeVisible();
    await page.getByLabel("Step editor").getByLabel("Name").fill("bad");
    const expr = page.getByLabel("Expression");
    await expr.fill("np.lo");
    await expect(page.getByRole("option", { name: "np.log1p(" })).toBeVisible();
    await captureFlowScreenshot(page, FLOW, "03-np-autocomplete.png");
    await expr.fill("Fare.apply(abs)");
    const err = page.locator(".formula-status.err");
    await expect(err).toBeVisible({ timeout: 20_000 });
    await expect(err).toContainText(
      /method calls like \.apply\(\.\.\.\) are not allowed/,
      { timeout: 20_000 },
    );
    await captureFlowScreenshot(page, FLOW, "04-engine-error.png");
  });
});
