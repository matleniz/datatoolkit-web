import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkbench,
  waitForGridReady,
} from "./helpers";

/**
 * MAT-231 / MAT-232: left panel is Suggestions only; left panel and the right
 * inspector collapse to a thin strip, the grid reflows, the state survives a
 * reload, and an open step editor can never be collapsed (no lost edit).
 */
test("MAT-231/232: collapsible side panels, Suggestions-only left panel", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const flow = "mat232-panels";
  clearFlowScreenshots(flow);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkbench(page, true);

    const inspector = page.getByRole("complementary", { name: "Inspector" });
  const main = page.locator(".workbench-main");
  const mainWidth = async () => (await main.boundingBox())!.width;

  // MAT-231: no tab strip, no Variables / Recipe entry points
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByText("Recipe ·")).toHaveCount(0);
  await expect(page.locator(".left-title")).toHaveText(/Suggestions · [1-9]/);

  // Both open
  await expect(inspector).toBeVisible();
  const openWidth = await mainWidth();
  await waitForGridReady(page);
  await captureFlowScreenshot(page, flow, "01-both-open.png");

  // Collapse left: strip + reopen button, grid gains room, count still current
  await page.getByRole("button", { name: "Collapse left panel" }).click();
  await expect(page.locator(".left-body")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Expand left panel" }),
  ).toBeVisible();
  await expect.poll(mainWidth).toBeGreaterThan(openWidth + 200);

  // Collapse right too
  await page.getByRole("button", { name: "Collapse right panel" }).click();
  await expect(inspector).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Expand right panel" }),
  ).toBeVisible();
  await expect.poll(mainWidth).toBeGreaterThan(openWidth + 450);
  await waitForGridReady(page);
  await captureFlowScreenshot(page, flow, "02-both-collapsed.png");

  // Persisted: still collapsed after a reload
  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await waitForGridReady(page);
  await expect(
    page.getByRole("button", { name: "Expand left panel" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Expand right panel" }),
  ).toBeVisible();

  // Step editor opens even while the inspector is collapsed and is not collapsible
  await page
    .getByRole("button", { name: "monthly_spend, number" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /Use in formula/ }).click();
  const editor = page.getByLabel("Step editor");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Expression").fill("monthly_spend * 2");
  const collapse = page.getByRole("button", { name: "Collapse right panel" });
  await expect(collapse).toBeDisabled();
  await collapse.click({ force: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Expression")).toHaveValue(
    "monthly_spend * 2",
  );

  // Discard the edit: the collapsed inspector strip comes back
  await editor.getByRole("button", { name: "Discard" }).first().click();
  await expect(editor).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Expand right panel" }),
  ).toBeVisible();

  // Reopen both
  await page.getByRole("button", { name: "Expand right panel" }).click();
  await page.getByRole("button", { name: "Expand left panel" }).click();
  await expect(inspector).toBeVisible();
  await expect(page.locator(".left-body")).toBeVisible();
  await waitForGridReady(page);
  await captureFlowScreenshot(page, flow, "03-reopened.png");
});
