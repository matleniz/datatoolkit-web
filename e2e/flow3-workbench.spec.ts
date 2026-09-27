import { expect, test } from "@playwright/test";
import type { Workspace } from "../src/api/types";
import { captureFlowScreenshot, churnWorkspace, fixturesDir } from "./helpers";

test("Flow 3: workbench (alignment first, sentinels, impute, onehot, time travel, delete, suggestions > 0)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Reset to clean workspace then navigate from alignment screen
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.__DTK_DISPATCH__ === "function",
  );

  const cleanWs: Workspace = {
    ...churnWorkspace(),
    datasets: {
      ...churnWorkspace().datasets,
      test: {
        x: {
          kind: "csv",
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
  }, cleanWs);
  await page.waitForFunction(async () => {
    const p = window.__DTK_WORKSPACE_SAVED__;
    if (!p) return false;
    await p;
    return true;
  });

  await expect(
    page.getByRole("main").getByText("Train / test alignment"),
  ).toBeVisible();

  // Apply alignment fixes
  await page
    .getByRole("button", { name: 'Re-read test with decimal ","' })
    .click();
  await page
    .getByRole("button", { name: "↔ nb_support_calls (similar name)" })
    .click();
  await page
    .locator(".align-table-row", { hasText: "promo_code" })
    .getByRole("button", { name: "Drop from test" })
    .click();
  await expect(page.getByText("0 to decide")).toBeVisible();

  // Open Workbench
  await page.getByRole("button", { name: "Open workbench →" }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible();
  await expect(page.getByLabel("Data grid")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".grid-th", { hasText: "age" })).toBeVisible({
    timeout: 30_000,
  });

  // (d) Confirm alignment steps appear first in pipeline bar with import colour (#6b5ea8)
  const renameNode = page.locator(".pipeline-node", { hasText: "Rename" }).first();
  const dropNode = page
    .locator(".pipeline-node", { hasText: "Drop columns" })
    .first();
  await expect(renameNode).toBeVisible();
  await expect(dropNode).toBeVisible();
  await expect(renameNode.locator(".pipeline-badge")).toContainText("align");
  await expect(dropNode.locator(".pipeline-badge")).toContainText("align");
  for (const node of [renameNode, dropNode]) {
    const bar = node.locator(".pipeline-stage-bar");
    await expect(bar).toHaveCSS("background-color", "rgb(107, 94, 168)");
  }

  // (a) Assert suggestions count > 0 after load
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.__DTK_STATE__?.()?.sugCount ?? 0),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("tab", { name: /Suggestions · [1-9]/ }),
  ).toBeVisible();

  // Screenshot 01: initial grid with alignment steps and suggestions
  await captureFlowScreenshot(page, "3-workbench", "01-grid.png");

  // 2. Right-click age -> Replace sentinels
  const ageHeader = page.locator(".grid-th", { hasText: "age" }).first();
  await ageHeader.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Column menu" })).toBeVisible();
  await page.getByRole("menuitem", { name: /Replace sentinels/ }).click();
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(
    page.getByText("Learned on train", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply step" }).first(),
  ).toBeEnabled({ timeout: 15_000 });

  await captureFlowScreenshot(
    page,
    "3-workbench",
    "02-replace-sentinels-editor.png",
  );

  // Apply replace sentinels
  await page.getByRole("button", { name: "Apply step" }).first().click();
  await expect(
    page.locator(".pipeline-node", { hasText: "Replace sentinels" }),
  ).toBeVisible({ timeout: 15_000 });

  // (a) Assert suggestions > 0 after applied step
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.__DTK_STATE__?.()?.sugCount ?? 0),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  // 3. Impute age (median)
  await ageHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Impute/ }).click();
  await expect(page.getByLabel("Step editor")).toBeVisible();
  await expect(page.getByText("Strategy", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const editor = page.getByLabel("Step editor");
  await expect(editor.getByRole("button", { name: "median" })).toBeVisible();
  await expect(
    page.getByText("Learned on train", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ed-learned")).toContainText(/fill|age/i, {
    timeout: 15_000,
  });

  await captureFlowScreenshot(page, "3-workbench", "03-impute-learned.png");

  // Apply impute
  await page.getByRole("button", { name: "Apply step" }).first().click();
  const imputeNode = page
    .locator(".pipeline-node", { hasText: "Impute" })
    .first();
  await expect(imputeNode).toBeVisible({ timeout: 15_000 });
  await expect(imputeNode).toContainText(/20\s*×\s*10/, { timeout: 20_000 });

  // (a) Assert suggestions > 0 after applied step
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.__DTK_STATE__?.()?.sugCount ?? 0),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  // 4. One-hot city with diff preview
  const cityHeader = page.locator(".grid-th", { hasText: "city" }).first();

  // Inspect city: Value groups lists canonical 'paris' with spellings, never 'normalized'
  await cityHeader.click();
  const inspector = page.getByLabel("Inspector");
  await expect(inspector).toBeVisible();
  const valueGroups = inspector.locator(".insp-groups");
  await expect(valueGroups).toBeVisible();
  await expect(valueGroups).toContainText("paris");
  await expect(valueGroups).not.toContainText("normalized");

  await cityHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: /One-hot/ }).click();
  await expect(page.getByText("Min Frequency", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Live preview")).toBeVisible({ timeout: 20_000 });

  const addedCol = page.locator(".grid-th.added").first();
  await expect(addedCol).toBeVisible({ timeout: 15_000 });
  const addedName = (
    (await addedCol.locator(".th-name").textContent()) ?? ""
  ).trim();
  expect(addedName.replace(/^[“”"]|[“”"]$/g, "")).toMatch(/^city_/);

  // First data cell of added col should be 0 or 1
  const firstAddedCell = page
    .locator(".grid-row")
    .first()
    .locator(".grid-td.tone-added")
    .first();
  await expect(firstAddedCell).toBeVisible();
  await expect(firstAddedCell).toHaveText(/^[01]$/);

  await captureFlowScreenshot(page, "3-workbench", "04-onehot-diff.png");

  // Apply one-hot
  await page.getByRole("button", { name: "Apply step" }).first().click();
  await expect(
    page.locator(".pipeline-node", { hasText: "One-hot" }),
  ).toBeVisible({ timeout: 15_000 });

  // (a) Assert suggestions > 0 after applied step
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.__DTK_STATE__?.()?.sugCount ?? 0),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  // 5. Time travel to an earlier version (v1)
  const v1Node = page
    .locator(".pipeline-node")
    .filter({ has: page.locator(".pipeline-ver", { hasText: /^v1$/ }) })
    .first();
  await v1Node.click();

  const travelBanner = page.locator(".travel-banner");
  await expect(travelBanner).toBeVisible();
  await expect(travelBanner).toContainText("v1");

  // Row 3 age cell shows -999 (not 36)
  const row3 = page.locator(".grid-row").nth(2);
  const row3Age = row3.locator('.grid-td[title^="age ="]');
  await expect(row3Age).toHaveText("-999");
  await expect(row3Age).not.toHaveText("36");

  await captureFlowScreenshot(page, "3-workbench", "05-time-travel.png");

  await page.getByRole("button", { name: "Back to latest" }).click();
  await expect(page.getByText("Time travel")).toHaveCount(0);

  // 6. Delete last step via ×
  const removeBtns = page.getByRole("button", {
    name: "Remove this step and replay",
  });
  const n = await removeBtns.count();
  expect(n).toBeGreaterThan(0);
  await removeBtns.last().click();
  await expect(
    page.locator(".pipeline-node", { hasText: "One-hot" }),
  ).toHaveCount(0, { timeout: 15_000 });

  // (a) Assert suggestions > 0 after deleting step
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.__DTK_STATE__?.()?.sugCount ?? 0),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  await captureFlowScreenshot(page, "3-workbench", "06-after-delete.png");
});
