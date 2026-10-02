import { expect, test, type Request } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  waitForAlignReady,
  waitForGridReady,
  waitForSuggestionsReady,
} from "./helpers";

const REAL_DATA_DIR = "/mnt/c/Users/mat24/Downloads";
const X_TRAIN = join(REAL_DATA_DIR, "X_train_6ZIKlTY.csv");
const X_TEST = join(REAL_DATA_DIR, "X_test_oiZ2ukx.csv");
const Y_TRAIN = join(REAL_DATA_DIR, "y_train_lXj6X5y.csv");

const realDataAvailable =
  existsSync(X_TRAIN) && existsSync(X_TEST) && existsSync(Y_TRAIN);

function requestFingerprint(r: Request): string | null {
  const url = r.url();
  if (!url.includes("/api/workspace/")) return null;
  if (r.method() !== "POST") return null;
  const path = url.split("/api")[1] ?? url;
  return `${r.method()} ${path} ${r.postData() ?? ""}`;
}

test("Flow 7: real dataset (parkinson upload through Sources screen, alignment, workbench)", async ({
  page,
}) => {
  test.skip(
    !realDataAvailable,
    `Real dataset Parkinson CSVs not present in ${REAL_DATA_DIR}`,
  );
  test.setTimeout(180_000);
  clearFlowScreenshots("7-real-data");
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

  await fileInput.setInputFiles(X_TRAIN);
  const filesList = page.getByRole("region", { name: "Files list" });
  await expect(filesList.getByText("X_train_6ZIKlTY.csv")).toBeVisible({
    timeout: 30_000,
  });

  await fileInput.setInputFiles(Y_TRAIN);
  await expect(filesList.getByText("y_train_lXj6X5y.csv")).toBeVisible({
    timeout: 30_000,
  });

  await fileInput.setInputFiles(X_TEST);
  await expect(filesList.getByText("X_test_oiZ2ukx.csv")).toBeVisible({
    timeout: 30_000,
  });

  const fileRows = filesList.locator(".files-table-row");
  await expect(fileRows).toHaveCount(3);
  await expect(filesList.getByText("churn_train.csv")).toHaveCount(0);

  const xTrainRow = filesList.locator(".files-table-row", {
    hasText: "X_train_6ZIKlTY.csv",
  });
  await expect(xTrainRow).toContainText("header 0");
  await expect(xTrainRow).toContainText("55,603");

  await xTrainRow.getByRole("button", { name: /Train X/ }).click();

  const yTrainRow = filesList.locator(".files-table-row", {
    hasText: "y_train_lXj6X5y.csv",
  });
  await yTrainRow.getByRole("button", { name: /Train y/ }).click();

  const xTestRow = filesList.locator(".files-table-row", {
    hasText: "X_test_oiZ2ukx.csv",
  });
  await xTestRow.getByRole("button", { name: /Test X/ }).click();

  await page.getByRole("button", { name: "Separate y file" }).click();
  await page.getByRole("button", { name: "By row order" }).click();

  const resultRegion = page.getByRole("region", { name: "Result schema" });
  await expect(resultRegion.getByText(/55\s?603/)).toBeVisible({
    timeout: 30_000,
  });

  await expect(
    resultRegion.locator(".res-col-chip", { hasText: "Index ◎" }),
  ).toHaveCount(0);
  await expect(
    resultRegion.locator(".res-col-chip", { hasText: "target" }),
  ).toContainText("◎");

  await expect(page.getByText("Loading…")).toHaveCount(0);
  await expect(page.getByText("Loading workspace…")).toBeHidden();

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

  await expect(page.locator(".align-table-row").first()).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    page.locator(".align-table-row", { hasText: "patient_id" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".align-status-badge").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Loading alignment report...")).toHaveCount(0);
  await waitForAlignReady(page);

  await captureFlowScreenshot(page, "7-real-data", "02-parkinson-align.png");

  // 6. Open workbench — assert grid ready < 8 s and no duplicate POSTs
  const workspacePosts: string[] = [];
  const onReq = (r: Request) => {
    const fp = requestFingerprint(r);
    if (fp) workspacePosts.push(fp);
  };
  page.on("request", onReq);

  const t0 = Date.now();
  await page.getByRole("button", { name: "Open workbench →" }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible();
  await waitForGridReady(page);
  const gridReadyMs = Date.now() - t0;
  page.off("request", onReq);

  expect(
    gridReadyMs,
    `grid ready in ${gridReadyMs}ms (target < 8000)`,
  ).toBeLessThan(8_000);

  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const fp of workspacePosts) {
    if (seen.has(fp)) dupes.push(fp.slice(0, 120));
    else seen.add(fp);
  }
  expect(
    dupes,
    `duplicate POST /workspace/* while opening:\n${dupes.join("\n")}`,
  ).toEqual([]);

  const rawNode = page
    .locator(".pipeline-node")
    .filter({ has: page.locator(".pipeline-ver", { hasText: /^raw$/ }) });
  await expect(rawNode).toContainText(/55\s?603\s*×\s*13/, {
    timeout: 60_000,
  });

  await expect(
    page.locator(".grid-th", { hasText: "patient_id" }),
  ).toBeVisible({ timeout: 30_000 });
  const patientIdCells = page.locator('.grid-td[title^="patient_id ="]');
  await expect(patientIdCells.first()).toBeVisible({ timeout: 30_000 });
  const firstPatientVal = (await patientIdCells.first().textContent())?.trim();
  expect(firstPatientVal).toBeTruthy();
  expect(firstPatientVal).not.toMatch(/^[–—∅]?$/);

  // Cold analysis cache on 55k rows when run alone: wait for the run to
  // settle, then check its outcome (#13).
  await waitForSuggestionsReady(page);
  await expect(
    page.getByRole("complementary", { name: "Suggestions" }).locator(".engine-error"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__DTK_STATE__?.()?.sugCount ?? 0),
  ).toBeGreaterThan(0);
  await expect(page.locator(".left-title")).toHaveText(
    /Suggestions · [1-9]/,
  );

  // Export Parkinson: default out_dir is absolute; run and show manifest paths
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const exportPanel = page.getByLabel("Export", { exact: true });
  await expect(exportPanel).toBeVisible();
  const outDirInput = page.getByLabel("Output directory");
  const outDirVal = await outDirInput.inputValue();
  expect(outDirVal.startsWith("/") || /^[A-Za-z]:[\\/]/.test(outDirVal)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Export parquet + manifest" }).click();
  const manifestRegion = page.locator('[aria-label="Export manifest"]');
  await expect(manifestRegion).toBeVisible({ timeout: 120_000 });
  const manifestText = await manifestRegion.innerText();
  expect(manifestText).toMatch(/train\.parquet/);
  expect(manifestText).toMatch(/manifest\.json|Output dir/);

  await waitForGridReady(page);
  await captureFlowScreenshot(
    page,
    "7-real-data",
    "03-parkinson-workbench.png",
  );
});
