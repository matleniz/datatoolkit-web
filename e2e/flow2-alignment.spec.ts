import { expect, test } from "@playwright/test";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  waitForAlignReady,
} from "./helpers";

test("Flow 2: alignment (decimal, rename, drop, city map -> 0 to decide)", async ({
  page,
}) => {
  clearFlowScreenshots("2-alignment");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Navigate to Alignment screen with clean unaligned workspace
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.__DTK_DISPATCH__ === "function",
  );

  const { churnWorkspace, fixturesDir } = await import("./helpers");
  const unalignedWs = {
    ...churnWorkspace(),
    datasets: {
      ...churnWorkspace().datasets,
      test: {
        x: {
          kind: "csv" as const,
          path: `${fixturesDir}/churn_test.csv`,
        },
      },
    },
    steps: [],
  };

  await page.evaluate((ws) => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_WORKSPACE", workspace: ws });
    d({ type: "SET_SCREEN", screen: "align" });
    d({ type: "CLEAR_SELECTION" });
  }, unalignedWs);
  await page.waitForFunction(async () => {
    const p = window.__DTK_WORKSPACE_SAVED__;
    if (!p) return false;
    await p;
    return true;
  });

  await expect(
    page.getByRole("main").getByText("Train / test alignment"),
  ).toBeVisible();

  // 2. Verify initial alignment issues
  await waitForAlignReady(page);
  await expect(page.getByText("to decide")).toBeVisible();
  await expect(
    page.getByText("Test stores numbers as text with a comma decimal."),
  ).toBeVisible();

  const rereadBtn = page.getByRole("button", {
    name: 'Re-read test with decimal ","',
  });
  await expect(rereadBtn).toBeVisible();

  const renameBtn = page.getByRole("button", {
    name: "↔ nb_support_calls (similar name)",
  });
  await expect(renameBtn).toBeVisible();

  const dropPromoTestBtn = page
    .locator(".align-table-row", { hasText: "promo_code" })
    .getByRole("button", { name: "Drop from test" });
  await expect(dropPromoTestBtn).toBeVisible();

  // Screenshot initial alignment screen
  await captureFlowScreenshot(page, "2-alignment", "01-align-initial.png");

  // 3. Apply fix 1: Decimal fix
  await rereadBtn.click();
  await expect(page.getByText('churn_test.csv · decimal ","')).toBeVisible();
  await waitForAlignReady(page);

  // 4. Apply fix 2: Rename nb_support_calls → support_calls
  await renameBtn.click();
  await expect(
    page.getByText("rename · nb_support_calls → support_calls · test"),
  ).toBeVisible();
  await waitForAlignReady(page);

  // 5. Apply fix 3: Drop extra column promo_code from test
  await dropPromoTestBtn.click();
  await expect(
    page.getByText("drop_columns · promo_code · test"),
  ).toBeVisible();
  await waitForAlignReady(page);

  // 6. Resolve city spelling near-matches (Lyon␠ / lille). Leftover rare
  // categories (Nice / nice) stay visible as value_mismatch but are not
  // "to decide" once near_matches are cleared (MAT-179).
  const cityRow = page.locator(".align-table-row", { hasText: "city" });
  await expect(cityRow.getByText("value mismatch")).toBeVisible();
  await cityRow.getByRole("button", { name: "Map on test" }).click();
  await expect(page.getByText(/standardize_text · city · map/)).toBeVisible();

  // 7. Verify resolved state: "0 to decide" (on the report for every fix)
  await waitForAlignReady(page);
  await expect(
    page.getByText("Train and test have the same columns and types."),
  ).toBeVisible();
  await expect(page.getByText("0 to decide")).toBeVisible();

  // Screenshot resolved alignment screen
  await captureFlowScreenshot(page, "2-alignment", "02-align-aligned.png");
});
