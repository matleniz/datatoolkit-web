import { expect, test } from "@playwright/test";
import {
  clearFlowScreenshots,
  openWorkbench,
  openWorkspaceBench,
  titanicWorkspace,
  waitForGridReady,
} from "./helpers";

test.describe("MAT-173 feature ops", () => {
  test("polynomial on multi-select + power_transform learned state (churn train/test)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    clearFlowScreenshots("mat173-feature-ops");
    await page.setViewportSize({ width: 1440, height: 900 });

    await openWorkbench(page, true);
    await waitForGridReady(page);

    // Select two numeric columns without missing (age has a NaN → poly refuses).
    await page.evaluate(() => {
      const w = window as unknown as {
        __DTK_DISPATCH__?: (a: unknown) => void;
      };
      const d = w.__DTK_DISPATCH__;
      if (!d) throw new Error("no dispatch");
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "monthly_spend" });
      d({ type: "PICK_COL", name: "sessions", add: true });
    });

    const spendHeader = page
      .locator(".grid-th", { hasText: "monthly_spend" })
      .first();
    await spendHeader.click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Column menu" });
    await expect(menu).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Polynomial features…" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Power transform…" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Quantile transform…" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "New feature…" }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "Polynomial features…" }).click();

    await expect(page.getByLabel("Step editor")).toBeVisible();
    await expect(page.locator(".ed-title")).toContainText("Polynomial");
    // Columns prefilled from selection.
    await expect(
      page.locator("[data-ed-field=columns] .small-chip.on", {
        hasText: "monthly_spend",
      }),
    ).toBeVisible();
    await expect(
      page.locator("[data-ed-field=columns] .small-chip.on", {
        hasText: "sessions",
      }),
    ).toBeVisible();

    const applyBtn = page.getByRole("button", { name: "Apply step" }).first();
    await expect(applyBtn).toBeEnabled({ timeout: 20_000 });
    // Live preview: readable poly names (degree 2 → 5 columns).
    await expect(
      page.locator(".grid-th", { hasText: "monthly_spend^2" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator(".grid-th", { hasText: "monthly_spend*sessions" }),
    ).toBeVisible();
    await expect(
      page.locator(".grid-th", { hasText: "sessions^2" }),
    ).toBeVisible();
    await applyBtn.click();
    await expect(
      page.locator(".pipeline-node", { hasText: "Polynomial" }),
    ).toBeVisible({ timeout: 20_000 });

    await waitForGridReady(page);
    for (const name of [
      "monthly_spend",
      "sessions",
      "monthly_spend^2",
      "monthly_spend*sessions",
      "sessions^2",
    ]) {
      await expect(page.locator(".grid-th", { hasText: name }).first()).toBeVisible();
    }

    // Same expansion on test.
    const datasetGroup = page.getByRole("group", { name: "Dataset shown" });
    await datasetGroup.getByRole("button", { name: "Test", exact: true }).click();
    await expect(
      datasetGroup.getByRole("button", { name: "Test", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitForGridReady(page);
    for (const name of [
      "monthly_spend^2",
      "monthly_spend*sessions",
      "sessions^2",
    ]) {
      await expect(page.locator(".grid-th", { hasText: name }).first()).toBeVisible({
        timeout: 20_000,
      });
    }

    // Back to train for power_transform.
    await datasetGroup.getByRole("button", { name: "Train", exact: true }).click();
    await waitForGridReady(page);

    await page.evaluate(() => {
      const w = window as unknown as {
        __DTK_DISPATCH__?: (a: unknown) => void;
      };
      const d = w.__DTK_DISPATCH__;
      if (!d) throw new Error("no dispatch");
      d({ type: "CLEAR_SELECTION" });
      d({ type: "PICK_COL", name: "monthly_spend" });
      d({ type: "PICK_COL", name: "sessions", add: true });
    });
    await spendHeader.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Power transform…" }).click();
    await expect(page.getByLabel("Step editor")).toBeVisible();
    await expect(page.locator(".ed-title")).toContainText("Power transform");
    await expect(page.getByText("Learned on train", { exact: true })).toBeVisible();
    // Fitted lambdas from train appear in the learned box (not "Not fitted").
    await expect(page.locator(".ed-learned")).toContainText("lambdas", {
      timeout: 20_000,
    });
    await expect(page.getByText("Not fitted: nothing is learned on train")).toHaveCount(
      0,
    );
    await expect(applyBtn).toBeEnabled({ timeout: 20_000 });
    await applyBtn.click();
    await expect(
      page.locator(".pipeline-node", { hasText: "Power transform" }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("New feature formula where(Age < 18, 1, 0) → is_child", async ({
    page,
  }) => {
    test.setTimeout(120_000);
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

    // Inspector multi → New feature…
    await expect(page.getByLabel("Inspector")).toBeVisible();
    await page.getByRole("button", { name: "New feature…" }).click();
    await expect(page.getByLabel("Step editor")).toBeVisible();
    await expect(page.locator("[data-formula-editor]")).toBeVisible();
    // Selected columns appear as highlighted chips.
    await expect(
      page.locator("[data-formula-col-chips] .tiny-chip.on", { hasText: "Age" }),
    ).toBeVisible();
    await expect(
      page.locator("[data-formula-col-chips] .tiny-chip.on", { hasText: "Fare" }),
    ).toBeVisible();
    // Function palette with help (title).
    await expect(
      page.locator("[data-formula-func-palette] .tiny-chip", { hasText: "where" }),
    ).toHaveAttribute("title", /where\(cond/);

    await page.getByLabel("Step editor").getByLabel("Name").fill("is_child");
    const expr = page.getByLabel("Expression");
    await expr.fill("where(Age < 18, 1, 0)");

    await expect(page.locator(".formula-status.ok")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator(".grid-th.added", { hasText: "is_child" }),
    ).toBeVisible({ timeout: 15_000 });

    const applyBtn = page.getByRole("button", { name: "Apply step" }).first();
    await expect(applyBtn).toBeEnabled();
    await applyBtn.click();
    await expect(
      page.locator(".pipeline-node", { hasText: "Formula" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(".grid-th", { hasText: "is_child" }),
    ).toBeVisible();
  });
});
