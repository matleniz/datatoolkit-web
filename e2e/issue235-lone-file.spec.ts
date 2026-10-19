import { expect, test } from "@playwright/test";
import { join } from "node:path";

import { expectNoA11yViolations } from "./a11y";
import { fixturesDir, sourceFileInput } from "./helpers";

/**
 * #235: the first file of an empty workspace is guessed Train X (never Merge)
 * and a lone file does not raise the three red role errors.
 */
test("#235: a lone customers.csv is Train X with no role errors; a second file is guessed as before", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "+ New workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill("issue235_lone");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Sources of “issue235_lone”")).toBeVisible({
    timeout: 15_000,
  });

  await sourceFileInput(page).setInputFiles(join(fixturesDir, "customers_extra.csv"));
  const filesList = page.getByRole("region", { name: "Files list" });
  const first = filesList.locator(".files-table-row", { hasText: "customers_extra.csv" });
  await expect(first).toBeVisible({ timeout: 30_000 });
  await expect(first.getByRole("button", { name: /Train X/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(first.getByRole("button", { name: /Merge/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByText(/Pick a Train X file/)).toHaveCount(0);
  await expect(page.getByText(/Train X required to configure merge/)).toHaveCount(0);
  await expect(page.getByText(/Give a file the role “Train y”, or pick/)).toHaveCount(0);
  // What is still missing (a target) shows as a calm hint, not an error.
  await expect(page.locator(".label-info.error")).toHaveCount(0);
  await expect(page.locator(".label-info.hint")).toBeVisible();
  await expectNoA11yViolations(page, "sources, lone file");

  // A second file keeps the name-based guess.
  await sourceFileInput(page).setInputFiles(join(fixturesDir, "churn_labels.csv"));
  const second = filesList.locator(".files-table-row", { hasText: "churn_labels.csv" });
  await expect(second).toBeVisible({ timeout: 30_000 });
  await expect(second.getByRole("button", { name: /Train y/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(first.getByRole("button", { name: /Train X/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
