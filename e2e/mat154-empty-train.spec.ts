import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { fixturesDir } from "./helpers";

const EMPTY_MSG =
  /This train file has no columns \(empty or unreadable\)/;

/**
 * MAT-154 item 1: 0-byte / 0-column train file must disable Open workbench
 * and alignment, with a clear message.
 */
test("MAT-154: empty train file disables workbench and alignment", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "+ New workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill("adv_empty_wb");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Sources of “adv_empty_wb”")).toBeVisible({
    timeout: 15_000,
  });

  const emptyPath = join(fixturesDir, "adv_empty.csv");
  await page.locator('input[type="file"]').setInputFiles(emptyPath);

  const filesList = page.getByRole("region", { name: "Files list" });
  await expect(filesList.getByText("adv_empty.csv")).toBeVisible({
    timeout: 30_000,
  });

  const row = filesList.locator(".files-table-row", {
    hasText: "adv_empty.csv",
  });
  await row.getByRole("button", { name: /Train X/ }).click();
  await expect(
    row.getByRole("button", { name: /Train X/ }),
  ).toHaveAttribute("aria-pressed", "true");

  await expect(page.getByText(EMPTY_MSG).first()).toBeVisible({
    timeout: 15_000,
  });

  const alignBtn = page.getByRole("button", {
    name: "Check train / test alignment →",
  });
  const benchBtn = page.getByRole("button", { name: "Open workbench" });
  await expect(alignBtn).toBeDisabled();
  await expect(benchBtn).toBeDisabled();

  // Stay on Sources — clicking must not navigate even if force-clicked.
  await benchBtn.click({ force: true });
  await expect(page.getByLabel("Sources screen")).toBeVisible();
  await expect(page.getByLabel("Workbench")).toHaveCount(0);
});
