import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { expectNoA11yViolations } from "./a11y";
import { fixturesDir, sourceFileInput } from "./helpers";

/**
 * datatoolkit-issues#250: a user Cancel reads as a neutral notice, not an
 * error. #239: an empty or binary upload is flagged on its own file row with
 * the engine's reason, and is never a ready Train X.
 */
async function newWorkspace(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "+ New workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(`Sources of “${name}”`)).toBeVisible({ timeout: 15_000 });
}

async function expectBlocked(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Open workbench" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Check train / test alignment →" }),
  ).toBeDisabled();
}

test("issue 239: an empty CSV is flagged on its row and blocks the workbench", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await newWorkspace(page, "e2e_239_empty");
  await sourceFileInput(page).setInputFiles(join(fixturesDir, "adv_empty.csv"));
  const warn = page.locator("[data-file-load-error]");
  await expect(warn).toBeVisible({ timeout: 30_000 });
  await expect(warn).toContainText("Empty file");
  await expect(warn).toContainText("file is empty");
  await expectBlocked(page);
  await expectNoA11yViolations(page, "empty file row warning (#239)");
});

test("issue 239: a binary file is flagged 'not a readable table' with the engine message", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await newWorkspace(page, "e2e_239_binary");
  // Deterministic pseudo-random bytes: never a parseable table.
  const buffer = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 131 + 7) & 255));
  await sourceFileInput(page).setInputFiles({
    name: "blob.bin",
    mimeType: "application/octet-stream",
    buffer,
  });
  const warn = page.locator("[data-file-load-error]");
  await expect(warn).toBeVisible({ timeout: 30_000 });
  await expect(warn).toContainText("Not a readable table");
  await expect(warn).toContainText("SourceError: cannot read csv");
  await expectBlocked(page);
  await expectNoA11yViolations(page, "binary file row warning (#239)");
});

test("issue 250: Cancel on a slow load shows a neutral notice, not an error", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await newWorkspace(page, "e2e_250_cancel");
  await page.route(/\/api\/uploads\//, async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue().catch(() => undefined);
  });
  await sourceFileInput(page).setInputFiles(join(fixturesDir, "churn_train.csv"));
  const busy = page.locator('[data-busy="source"]');
  await expect(busy).toBeVisible({ timeout: 10_000 });
  await busy.getByRole("button", { name: "Cancel" }).click();
  const notice = page.getByText("Load cancelled");
  await expect(notice).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Load cancelled" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /cancel/i })).toHaveCount(0);
  await expectNoA11yViolations(page, "neutral cancel notice (#250)");
});
