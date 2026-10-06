import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import {
  clearFlowScreenshots,
  fixturesDir,
  waitForGridReady,
  sourceFileInput,
} from "./helpers";

const EVENTS_PARQUET = join(fixturesDir, "events.parquet");
const STORE_C_XLSX = join(fixturesDir, "store_c.xlsx");
const EVENTS_JSONL = join(fixturesDir, "events.jsonl");
const EMPLOYEES_JSON = join(fixturesDir, "employees.json");
const STORE_B_CSV = join(fixturesDir, "store_b.csv");

async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "+ New workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(`Sources of “${name}”`)).toBeVisible({
    timeout: 15_000,
  });
}

async function waitOptionsIdle(page: Page): Promise<void> {
  await expect(page.getByText("Updating preview…")).toHaveCount(0, {
    timeout: 30_000,
  });
}

async function uploadAsTrainX(
  page: Page,
  filePath: string,
  fileName: string,
): Promise<void> {
  const fileInput = sourceFileInput(page);
  await fileInput.setInputFiles(filePath);
  const filesList = page.getByRole("region", { name: "Files list" });
  const row = filesList.locator(".files-table-block, .files-table-row", {
    hasText: fileName,
  });
  await expect(row.first()).toBeVisible({ timeout: 30_000 });
  await row.first().getByRole("button", { name: /Train X/ }).click();
}

async function openWorkbenchAndExpectShape(
  page: Page,
  shape: RegExp,
  column: string | RegExp,
): Promise<void> {
  await page.getByRole("button", { name: "Open workbench" }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible({ timeout: 30_000 });
  await waitForGridReady(page);
  const rawNode = page
    .locator(".pipeline-node")
    .filter({ has: page.locator(".pipeline-ver", { hasText: /^raw$/ }) });
  await expect(rawNode).toContainText(shape, { timeout: 60_000 });
  await expect(page.locator(".grid-th", { hasText: column })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("MAT-148 / MAT-151 source formats", () => {
  test.beforeEach(() => {
    clearFlowScreenshots("formats");
  });

  test("parquet upload opens workbench with the right shape", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createWorkspace(page, "fmt-parquet");
    await uploadAsTrainX(page, EVENTS_PARQUET, "events.parquet");
    const filesList = page.getByRole("region", { name: "Files list" });
    await expect(filesList).toContainText("parquet");
    await expect(filesList).not.toContainText(/csv · sep/);
    await openWorkbenchAndExpectShape(page, /3\s*×\s*4/, "user_id");
  });

  test("excel upload: pick sheet 2025 then open workbench", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createWorkspace(page, "fmt-excel");
    await uploadAsTrainX(page, STORE_C_XLSX, "store_c.xlsx");
    const filesList = page.getByRole("region", { name: "Files list" });
    await expect(filesList).toContainText("excel");

    const options = page.getByLabel("Load options for store_c.xlsx");
    await expect(options).toBeVisible({ timeout: 15_000 });
    await options.getByLabel("sheet").selectOption("2025");
    await waitOptionsIdle(page);
    // Wait for re-preview after sheet change (header should become 2).
    await expect(filesList).toContainText(/sheet "2025"/, { timeout: 30_000 });
    await expect(filesList).toContainText(/header 2/);

    await openWorkbenchAndExpectShape(page, /3\s*×\s*3/, "product_id");
  });

  test("jsonl upload opens workbench with flattened columns", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createWorkspace(page, "fmt-jsonl");
    await uploadAsTrainX(page, EVENTS_JSONL, "events.jsonl");
    const filesList = page.getByRole("region", { name: "Files list" });
    await expect(filesList).toContainText(/json · lines/);
    await openWorkbenchAndExpectShape(page, /2\s*×\s*3/, "amount");
  });

  test("enveloped json: record_path picker opens workbench", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createWorkspace(page, "fmt-employees");
    await uploadAsTrainX(page, EMPLOYEES_JSON, "employees.json");
    const filesList = page.getByRole("region", { name: "Files list" });
    await expect(filesList).toContainText(/record_path "employees"/);

    const options = page.getByLabel("Load options for employees.json");
    await expect(options).toBeVisible({ timeout: 15_000 });
    await expect(options.getByLabel("record_path")).toHaveValue("employees");

    await openWorkbenchAndExpectShape(page, /2\s*×\s*3/, "name");
  });

  test("French CSV fixed through Options editor → 3×4 prices", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createWorkspace(page, "fmt-store-b");
    await uploadAsTrainX(page, STORE_B_CSV, "store_b.csv");

    // A readable CSV upload keeps its Options collapsed (#83): open them.
    const options = page.getByLabel("Load options for store_b.csv");
    await page
      .getByRole("button", { name: "Options", exact: true })
      .first()
      .click();
    await expect(options).toBeVisible({ timeout: 15_000 });

    // Force a wrong sniff-style state, then fix via Options (acceptance).
    await options.getByLabel("sep").fill(",");
    await waitOptionsIdle(page);
    await options.getByLabel("decimal").fill(".");
    await waitOptionsIdle(page);
    await options.getByLabel("header").fill("0");
    await waitOptionsIdle(page);

    // Now correct values for the French title-line CSV.
    await options.getByLabel("sep").fill(";");
    await waitOptionsIdle(page);
    await options.getByLabel("decimal").fill(",");
    await waitOptionsIdle(page);
    await options.getByLabel("header").fill("1");
    await waitOptionsIdle(page);

    const filesList = page.getByRole("region", { name: "Files list" });
    await expect(filesList).toContainText(/sep ";"/, { timeout: 30_000 });
    await expect(filesList).toContainText(/header 1/);
    await expect(filesList).toContainText(/3\s*×\s*4/);

    await openWorkbenchAndExpectShape(page, /3\s*×\s*4/, "price");
    // Numeric price (decimal comma parsed) — not "1,50" as text blob.
    const priceCell = page.locator('.grid-td[title^="price ="]').first();
    await expect(priceCell).toBeVisible({ timeout: 30_000 });
    const priceText = (await priceCell.textContent())?.trim() ?? "";
    expect(priceText).toMatch(/1\.5/);
  });

  test("Add file label does not promise sql query", async ({ page }) => {
    await createWorkspace(page, "fmt-label");
    const add = page.getByText("+ Add a file");
    await expect(add).toBeVisible();
    await expect(add).toContainText("csv, parquet, excel, json");
    await expect(add).not.toContainText("sql");
  });
});
