import { expect, test } from "@playwright/test";
import { join } from "node:path";

import { expectNoA11yViolations } from "./a11y";
import { captureFlowScreenshot, clearFlowScreenshots, fixturesDir } from "./helpers";

/**
 * datatoolkit-issues#265 — destructive actions ask through an accessible modal
 * dialog instead of window.confirm: named by its title, described by its text,
 * focus starts on Cancel and stays inside, Escape cancels, axe is clean.
 */
test("issue 265: delete workspace asks through an accessible dialog", async ({ page, request }) => {
  test.setTimeout(180_000);
  clearFlowScreenshots("265-confirm-dialog");
  const name = "confirm265";
  const res = await request.put(`/api/workspaces/${name}`, {
    data: {
      name,
      datasets: { train: { x: { kind: "csv", path: join(fixturesDir, "churn_train.csv") } } },
      label: { mode: "order" },
      merges: [],
      variables: [],
      groups: [],
      steps: [],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const native: string[] = [];
  page.on("dialog", (d) => {
    native.push(d.message());
    void d.dismiss();
  });

  try {
    await page.goto("/");
    const sidebar = page.getByLabel("Workspaces");
    const item = sidebar.locator(`.ws-item[data-workspace="${name}"]`);
    await expect(item).toBeVisible({ timeout: 60_000 });

    const trigger = item.getByRole("button", { name: "Delete", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Delete workspace" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(/confirm265/);
    // Default focus is the safe action.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await captureFlowScreenshot(page, "265-confirm-dialog", "01-dialog.png");
    await expectNoA11yViolations(page, "confirm dialog open");

    // Focus never reaches the inert page: Tab stays on the two buttons, or leaves
    // to the browser UI (activeElement = body), as with any native modal dialog.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () =>
          document.activeElement === document.body ||
          !!document.activeElement?.closest("dialog.confirm-dialog"),
      );
      expect(inside).toBe(true);
    }

    // Escape cancels: the workspace is still there and focus returns to the trigger.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(item).toBeVisible();
    await expect(trigger).toBeFocused();

    // Cancel button cancels too.
    await trigger.click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(item).toBeVisible();

    // Confirm deletes.
    await trigger.click();
    await page
      .getByRole("dialog", { name: "Delete workspace" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(item).toHaveCount(0, { timeout: 15_000 });
    expect(native).toEqual([]);
  } finally {
    await request.delete(`/api/workspaces/${name}`);
  }
});
