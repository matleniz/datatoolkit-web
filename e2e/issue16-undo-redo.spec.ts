import { expect, test, type Page } from "@playwright/test";
import { openWorkbench } from "./helpers";

const stepOps = (page: Page) =>
  page.evaluate(
    () => window.__DTK_STATE__?.()?.workspace?.steps.map((s) => s.op) ?? [],
  );

/**
 * datatoolkit-issues#16 (undo / redo part only): apply Impute then Scale;
 * remove Scale then Undo → Scale back at its place; Redo removes it again;
 * Ctrl+Z / Ctrl+Shift+Z do the same from the keyboard.
 */
test("issue 16: undo / redo the pipeline history", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);

  const undo = page.getByRole("button", { name: "Undo pipeline change" });
  const redo = page.getByRole("button", { name: "Redo pipeline change" });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({
      type: "ADD_STEP",
      step: {
        op: "impute",
        target: "both",
        params: { columns: ["age"], strategy: "median" },
      },
    });
    d({
      type: "ADD_STEP",
      step: { op: "scale", target: "both", params: { columns: ["age"] } },
    });
  });
  const scaleNode = page.locator(".pipeline-node", { hasText: "Scale" });
  await expect(scaleNode).toHaveCount(1);
  await expect(page.locator(".pipeline-node", { hasText: "Impute" })).toHaveCount(1);
  expect(await stepOps(page)).toEqual(["impute", "scale"]);

  // Remove Scale with × (the pipeline replays), then Undo → back.
  await page
    .locator(".pipeline-node-rel", { has: scaleNode })
    .getByRole("button", { name: "Remove this step and replay" })
    .click();
  await expect(scaleNode).toHaveCount(0);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(scaleNode).toHaveCount(1);
  await expect(scaleNode).toContainText("v2");
  expect(await stepOps(page)).toEqual(["impute", "scale"]);

  // Redo → removed again; undo once more → back.
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(scaleNode).toHaveCount(0);
  await expect(redo).toBeDisabled();

  // Keyboard (focus outside any text field).
  await page.locator(".pipeline-legend").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(scaleNode).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(scaleNode).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(scaleNode).toHaveCount(1);

  // Undo all the way: no steps, Undo disabled; the replayed grid follows.
  await undo.click();
  await undo.click();
  await expect.poll(() => stepOps(page)).toEqual([]);
  await expect(undo).toBeDisabled();
  await expect(page.locator(".pipeline-node", { hasText: "Impute" })).toHaveCount(0);
});
