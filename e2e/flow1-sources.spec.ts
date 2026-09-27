import { expect, test } from "@playwright/test";
import { captureFlowScreenshot } from "./helpers";

test("Flow 1: sources (roles, y by order, merge extra table, result chips)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Load Sources screen
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Sources of “churn”")).toBeVisible();

  // 2. Verify Files list and detected specs
  const filesList = page.getByRole("region", { name: "Files list" });
  await expect(filesList.getByText("churn_train.csv")).toBeVisible();
  await expect(filesList.getByText("churn_labels.csv")).toBeVisible();
  await expect(filesList.getByText("churn_test.csv")).toBeVisible();
  await expect(filesList.getByText("customers_extra.csv")).toBeVisible();

  // 3. Verify Roles
  const trainXRole = filesList
    .locator(".files-table-row", { hasText: "churn_train.csv" })
    .getByRole("button", { name: /Train X/ });
  await expect(trainXRole).toHaveAttribute("aria-pressed", "true");

  const trainYRole = filesList
    .locator(".files-table-row", { hasText: "churn_labels.csv" })
    .getByRole("button", { name: /Train y/ });
  await expect(trainYRole).toHaveAttribute("aria-pressed", "true");

  const testXRole = filesList
    .locator(".files-table-row", { hasText: "churn_test.csv" })
    .getByRole("button", { name: /Test X/ });
  await expect(testXRole).toHaveAttribute("aria-pressed", "true");

  const mergeRole = filesList
    .locator(".files-table-row", { hasText: "customers_extra.csv" })
    .getByRole("button", { name: /Merge/ });
  await expect(mergeRole).toHaveAttribute("aria-pressed", "true");

  // 4. Verify Target card
  await expect(
    page.getByRole("button", { name: "Separate y file" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "By row order" }),
  ).toBeVisible();

  // 5. Verify Merge settings
  const mergeRegion = page.getByRole("region", { name: "Merge settings" });
  await expect(mergeRegion.getByText("Merge", { exact: true })).toBeVisible();
  await expect(mergeRegion.getByText("Also merge into test: yes")).toBeVisible();

  // 6. Verify Result card with shapes and coloured origin chips
  const resultRegion = page.getByRole("region", { name: "Result schema" });
  await expect(resultRegion.getByText(/train 20 ×/)).toBeVisible();
  await expect(resultRegion.getByText(/test 6 ×/)).toBeVisible();

  const xChips = resultRegion.locator(".res-col-chip.origin-x");
  const yChips = resultRegion.locator(".res-col-chip.origin-y");
  const mergeChips = resultRegion.locator(".res-col-chip.origin-merge");
  expect(await xChips.count()).toBeGreaterThan(0);
  expect(await yChips.count()).toBeGreaterThan(0);
  expect(await mergeChips.count()).toBeGreaterThan(0);

  // 7. Capture screenshot
  await captureFlowScreenshot(page, "1-sources", "01-sources-screen.png");
});
