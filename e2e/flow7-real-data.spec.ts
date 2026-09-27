import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { captureFlowScreenshot } from "./helpers";

const REAL_DATA_DIR = "/mnt/c/Users/mat24/Downloads";
const X_TRAIN = join(REAL_DATA_DIR, "X_train_6ZIKlTY.csv");
const X_TEST = join(REAL_DATA_DIR, "X_test_oiZ2ukx.csv");
const Y_TRAIN = join(REAL_DATA_DIR, "y_train_lXj6X5y.csv");

const realDataAvailable =
  existsSync(X_TRAIN) && existsSync(X_TEST) && existsSync(Y_TRAIN);

test("Flow 7: real dataset (parkinson upload through Sources screen, alignment, workbench)", async ({
  page,
}) => {
  test.skip(
    !realDataAvailable,
    `Real dataset Parkinson CSVs not present in ${REAL_DATA_DIR}`,
  );
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Go to Sources screen
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({
    timeout: 60_000,
  });

  // 2. Create new workspace "parkinson"
  await page.getByRole("button", { name: "+ New workspace" }).click();
  const wsInput = page.getByPlaceholder("Workspace name");
  await wsInput.fill("parkinson");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Sources of “parkinson”")).toBeVisible({
    timeout: 15_000,
  });

  // 3. Upload real Parkinson files via file input
  const fileInput = page.locator('input[type="file"]');

  // Upload X_train
  await fileInput.setInputFiles(X_TRAIN);
  const filesList = page.getByRole("region", { name: "Files list" });
  await expect(filesList.getByText("X_train_6ZIKlTY.csv")).toBeVisible({
    timeout: 30_000,
  });

  // Upload y_train
  await fileInput.setInputFiles(Y_TRAIN);
  await expect(filesList.getByText("y_train_lXj6X5y.csv")).toBeVisible({
    timeout: 30_000,
  });

  // Upload X_test
  await fileInput.setInputFiles(X_TEST);
  await expect(filesList.getByText("X_test_oiZ2ukx.csv")).toBeVisible({
    timeout: 30_000,
  });

  // 4. Assert only the 3 parkinson files are listed in that workspace
  const fileRows = filesList.locator(".files-table-row");
  await expect(fileRows).toHaveCount(3);
  await expect(filesList.getByText("churn_train.csv")).toHaveCount(0);
  await expect(filesList.getByText("churn_labels.csv")).toHaveCount(0);
  await expect(filesList.getByText("churn_test.csv")).toHaveCount(0);
  await expect(filesList.getByText("customers_extra.csv")).toHaveCount(0);

  // Sources shows 'header 0' and '55603' for X_train
  const xTrainRow = filesList.locator(".files-table-row", {
    hasText: "X_train_6ZIKlTY.csv",
  });
  await expect(xTrainRow).toContainText("header 0");
  await expect(xTrainRow).toContainText("55603");

  await xTrainRow.getByRole("button", { name: /Train X/ }).click();

  const yTrainRow = filesList.locator(".files-table-row", {
    hasText: "y_train_lXj6X5y.csv",
  });
  await yTrainRow.getByRole("button", { name: /Train y/ }).click();

  const xTestRow = filesList.locator(".files-table-row", {
    hasText: "X_test_oiZ2ukx.csv",
  });
  await xTestRow.getByRole("button", { name: /Test X/ }).click();

  // Target card: Separate y file, By row order
  await page.getByRole("button", { name: "Separate y file" }).click();
  await page.getByRole("button", { name: "By row order" }).click();

  // Wait for Result card to reflect the real dataset dimensions (55603 rows)
  const resultRegion = page.getByRole("region", { name: "Result schema" });
  await expect(resultRegion.getByText(/55\s?603/)).toBeVisible({
    timeout: 30_000,
  });

  // Target chip is 'target' (never 'Index ◎')
  await expect(
    resultRegion.locator(".res-col-chip", { hasText: "Index ◎" }),
  ).toHaveCount(0);
  await expect(
    resultRegion.locator(".res-col-chip", { hasText: "target" }),
  ).toContainText("◎");

  // Never screenshot a loading state
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await expect(page.getByText("Loading workspace…")).toBeHidden();

  // Screenshot 01: Sources screen with real data
  await captureFlowScreenshot(
    page,
    "7-real-data",
    "01-parkinson-sources.png",
  );

  // 5. Navigate to Alignment screen
  await page
    .getByRole("button", { name: "Check train / test alignment →" })
    .click();
  await expect(
    page.getByRole("main").getByText("Train / test alignment"),
  ).toBeVisible();

  // Never screenshot a loading state
  await expect(page.getByText("Loading…")).toHaveCount(0);

  // Screenshot 02: Alignment screen with real data
  await captureFlowScreenshot(page, "7-real-data", "02-parkinson-align.png");

  // 6. Navigate to Workbench
  await page.getByRole("button", { name: "Open workbench →" }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible();
  await expect(page.getByLabel("Data grid")).toBeVisible({ timeout: 60_000 });

  // Pipeline raw shape '55603 × 13'
  const rawNode = page
    .locator(".pipeline-node")
    .filter({ has: page.locator(".pipeline-ver", { hasText: /^raw$/ }) });
  await expect(rawNode).toContainText(/55\s?603\s*×\s*13/);

  // Workbench grid shows rows with patient_id values
  await expect(
    page.locator(".grid-th", { hasText: "patient_id" }),
  ).toBeVisible({ timeout: 30_000 });
  const patientIdCells = page.locator('.grid-td[title^="patient_id ="]');
  await expect(patientIdCells.first()).toBeVisible({ timeout: 30_000 });
  const firstPatientVal = (await patientIdCells.first().textContent())?.trim();
  expect(firstPatientVal).toBeTruthy();
  expect(firstPatientVal).not.toMatch(/^[–—∅]?$/);

  // Suggestions count > 0
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.__DTK_STATE__?.()?.sugCount ?? 0),
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("tab", { name: /Suggestions · [1-9]/ }),
  ).toBeVisible();

  // Never screenshot a loading state
  await expect(page.locator(".dock-window:has-text('Loading…')")).toHaveCount(0);
  await expect(page.getByText("Loading workspace…")).toBeHidden();

  // Screenshot 03: Workbench with real data
  await captureFlowScreenshot(
    page,
    "7-real-data",
    "03-parkinson-workbench.png",
  );
});
