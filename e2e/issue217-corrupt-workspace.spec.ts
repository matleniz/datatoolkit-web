import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * datatoolkit-issues#217: an unreadable workspace file is listed as a
 * `{name, corrupt, error}` marker (engine #215). The sidebar shows a badge,
 * search does not crash, open is disabled, delete still works.
 */
test("#217: corrupt workspace is listed, searchable and deletable", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const home = process.env.DTK_E2E_HOME;
  if (!home) throw new Error("DTK_E2E_HOME is not set by playwright.config");
  const dir = join(home, "workspaces");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "broken217.json"), "{ not valid json", "utf-8");

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({
    timeout: 60_000,
  });
  const sidebar = page.getByLabel("Workspaces");
  const item = sidebar.locator('.ws-item[data-workspace="broken217"]');
  await expect(item).toBeVisible({ timeout: 30_000 });
  const badge = item.locator(".ws-badge-corrupt");
  await expect(badge).toHaveText("corrupt");
  await expect(badge).toHaveAttribute("title", /Unreadable workspace file/);
  await expect(item.locator(".ws-item-select")).toBeDisabled();

  const search = sidebar.getByLabel("Search workspaces");
  await search.fill("churn");
  await expect(item).toHaveCount(0);
  await search.fill("broken");
  await expect(item).toBeVisible();

  page.once("dialog", (d) => {
    expect(d.message()).not.toContain("undefined");
    void d.accept();
  });
  await item.getByRole("button", { name: "Delete" }).click();
  await expect(item).toHaveCount(0, { timeout: 15_000 });
  expect(errors).toEqual([]);
});
