import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const shotDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "screenshots/workbench",
);
const docsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../docs/screenshots/w2-workbench-core",
);

async function openBench(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible();
  await expect(page.getByLabel("Data grid")).toBeVisible({ timeout: 30_000 });
  // Wait for age header (data loaded)
  await expect(page.locator(".grid-th", { hasText: "age" })).toBeVisible({
    timeout: 30_000,
  });
}

/** Fail loudly if Workbench.css stops applying (e.g. unclosed rule nests grid/inspector). */
async function assertWorkbenchLayout(
  page: import("@playwright/test").Page,
  mode: "inspector" | "editor",
) {
  const header = page.locator(".grid-th").first();
  const headerBox = await header.boundingBox();
  expect(headerBox, "header cell box").not.toBeNull();
  expect(headerBox!.width, "header cell width").toBeGreaterThanOrEqual(96);
  expect(headerBox!.height, "header cell height").toBe(100);

  const cell = page.locator(".grid-td").first();
  const cellBox = await cell.boundingBox();
  expect(cellBox, "grid cell box").not.toBeNull();
  expect(cellBox!.height, "grid cell height").toBe(30);

  const grid = page.getByLabel("Data grid");
  const gridBox = await grid.boundingBox();
  expect(gridBox, "grid box").not.toBeNull();
  const gridRight = gridBox!.x + gridBox!.width;

  if (mode === "inspector") {
    const inspector = page.getByLabel("Inspector");
    await expect(inspector).toBeVisible();
    const inspBox = await inspector.boundingBox();
    expect(inspBox, "inspector box").not.toBeNull();
    // Flush adjacency is fine; overlap would mean insp.x < gridRight.
    expect(inspBox!.x, "inspector to the right of grid").toBeGreaterThanOrEqual(
      gridRight,
    );
  } else {
    const editor = page.getByLabel("Step editor");
    await expect(editor).toBeVisible();
    const edBox = await editor.boundingBox();
    expect(edBox, "step editor box").not.toBeNull();
    expect(edBox!.x, "step editor to the right of grid").toBeGreaterThanOrEqual(
      gridRight,
    );

    const title = editor.locator(".ed-title").first();
    await expect(title).toBeVisible();
    const titleBox = await title.boundingBox();
    expect(titleBox, "step editor title box").not.toBeNull();
    expect(titleBox!.x, "title inside editor (left)").toBeGreaterThanOrEqual(edBox!.x);
    expect(
      titleBox!.x + titleBox!.width,
      "title inside editor (right)",
    ).toBeLessThanOrEqual(edBox!.x + edBox!.width + 1);
    expect(titleBox!.y, "title inside editor (top)").toBeGreaterThanOrEqual(edBox!.y);
    expect(
      titleBox!.y + titleBox!.height,
      "title inside editor (bottom)",
    ).toBeLessThanOrEqual(edBox!.y + edBox!.height + 1);
  }
}

test.beforeAll(() => {
  mkdirSync(shotDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
});

test("workbench: replace sentinels → impute → one-hot → time travel → delete", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBench(page);
  await assertWorkbenchLayout(page, "inspector");

  await page.screenshot({
    path: join(shotDir, "01-grid.png"),
    fullPage: true,
  });

  // Right-click age → Replace sentinels
  const ageHeader = page.locator(".grid-th", { hasText: "age" }).first();
  await ageHeader.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Column menu" })).toBeVisible();
  await page.getByRole("menuitem", { name: /Replace sentinels/ }).click();
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(page.getByText("Learned on train", { exact: true })).toBeVisible();
  // Stateless op — "Nothing: stateless" or empty state
  await expect(page.getByRole("button", { name: "Apply step" }).first()).toBeEnabled({
    timeout: 15_000,
  });
  await assertWorkbenchLayout(page, "editor");
  await page.screenshot({
    path: join(shotDir, "02-replace-sentinels-editor.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Apply step" }).first().click();
  await expect(page.getByText("v1")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({
    path: join(docsDir, "replace-sentinels.png"),
    fullPage: true,
  });

  // Impute age — schema fields + learned fill visible
  await ageHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Impute/ }).click();
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(page.getByText("Strategy", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const editor = page.getByLabel("Step editor");
  await expect(editor.getByRole("button", { name: "median" })).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "most_frequent" }),
  ).toBeVisible();
  await expect(page.getByText("Add Indicator", { exact: true })).toBeVisible();
  await expect(page.getByText("Learned on train", { exact: true })).toBeVisible();
  await expect(page.locator(".ed-learned")).toContainText(/fill|age/i, {
    timeout: 15_000,
  });
  await page.screenshot({
    path: join(shotDir, "03-impute-learned.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Apply step" }).first().click();
  await expect(page.getByText("v2")).toBeVisible({ timeout: 15_000 });
  // Pipeline node v2 must show shape, not em-dash
  const v2Node = page.locator(".pipeline-node", { hasText: "v2" }).first();
  await expect(v2Node).toContainText(/20\s*×\s*10/, { timeout: 20_000 });

  // One-hot city with diff — real 0/1 values in added columns
  const cityHeader = page.locator(".grid-th", { hasText: "city" }).first();
  await cityHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: /One-hot/ }).click();
  await expect(page.getByText("Min Frequency", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Drop First", { exact: true })).toBeVisible();
  await expect(page.getByText("Handle Unknown", { exact: true })).toBeVisible();
  await expect(page.getByText("Live preview")).toBeVisible({ timeout: 20_000 });
  // Live-preview banner "Apply step" must stay on one line
  const applyBtn = page
    .locator(".preview-banner")
    .getByRole("button", { name: "Apply step" });
  await expect(applyBtn).toBeVisible();
  const applyBox = await applyBtn.boundingBox();
  expect(applyBox, "Apply step box").not.toBeNull();
  expect(applyBox!.height, "Apply step single-line height").toBeLessThanOrEqual(36);
  const addedCol = page.locator(".grid-th.added").first();
  await expect(addedCol).toBeVisible({ timeout: 15_000 });
  const addedName = ((await addedCol.locator(".th-name").textContent()) ?? "").trim();
  // Strip curly quotes used when the category has leading/trailing spaces
  const addedBare = addedName.replace(/^[“”"]|[“”"]$/g, "");
  expect(addedBare).toMatch(/^city_/);
  // city has both "Lille" and "Lille " → one header must show quoted trailing space
  const quotedLille = page.locator(".grid-th.added .th-name", {
    hasText: "city_Lille",
  });
  const quotedTexts = await quotedLille.allTextContents();
  expect(
    quotedTexts.some((t) => /[“"]city_Lille\s+[”"]/.test(t)),
    `expected a quoted city_Lille-with-trailing-space header, got: ${JSON.stringify(quotedTexts)}`,
  ).toBe(true);
  // First data cell of the first added column should be 0 or 1, not "missing"
  const firstAddedCell = page
    .locator(".grid-row")
    .first()
    .locator(".grid-td.tone-added")
    .first();
  await expect(firstAddedCell).toBeVisible();
  await expect(firstAddedCell).toHaveText(/^[01]$/);
  await assertWorkbenchLayout(page, "editor");
  await page.screenshot({
    path: join(shotDir, "04-onehot-diff.png"),
    fullPage: true,
  });

  // Toolbar stays on one line at 1440 and 1280
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ] as const) {
    await page.setViewportSize(size);
    const toolbar = page.locator(".grid-toolbar");
    const box = await toolbar.boundingBox();
    expect(box, `toolbar box at ${size.width}`).not.toBeNull();
    expect(box!.height, `toolbar height at ${size.width}`).toBeLessThanOrEqual(48);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Apply step" }).first().click();
  await expect(page.getByText("v3")).toBeVisible({ timeout: 15_000 });

  // Time travel to v1
  await page.locator(".pipeline-node", { hasText: "v1" }).first().click();
  await expect(page.getByText("Time travel")).toBeVisible();
  await assertWorkbenchLayout(page, "inspector");
  await page.screenshot({
    path: join(shotDir, "05-time-travel.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back to latest" }).click();
  await expect(page.getByText("Time travel")).toHaveCount(0);

  // Delete last step via ×
  const removeBtns = page.getByRole("button", {
    name: "Remove this step and replay",
  });
  const n = await removeBtns.count();
  expect(n).toBeGreaterThan(0);
  await removeBtns.last().click();
  await expect(page.locator(".pipeline-ver", { hasText: "v3" })).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.screenshot({
    path: join(shotDir, "06-after-delete.png"),
    fullPage: true,
  });
  await page.screenshot({
    path: join(docsDir, "workbench.png"),
    fullPage: true,
  });
});
