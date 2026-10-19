import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectNoA11yViolations } from "./a11y";

/**
 * datatoolkit-issues#236: the remembered workspace's file is truncated. Studio
 * opens another workspace, shows a dismissible notice naming it with the
 * engine's reason, and the list entry explains itself without a hover.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api`;

test("#236: corrupt remembered workspace is announced and explained", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const home = process.env.DTK_E2E_HOME;
  if (!home) throw new Error("DTK_E2E_HOME is not set by playwright.config");
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });

  const put = await request.put(`${API}/workspaces/trunc236`, {
    data: {
      name: "trunc236",
      datasets: { train: { x: { kind: "csv", path: "/tmp/none.csv" } } },
      label: { mode: "order" },
      merges: [],
      variables: [],
      steps: [],
    },
  });
  expect(put.ok()).toBeTruthy();
  const file = join(home, "workspaces", "trunc236.json");
  const body = readFileSync(file, "utf-8");
  writeFileSync(file, body.slice(0, Math.floor(body.length / 2)), "utf-8");

  try {
    await page.addInitScript(() => localStorage.setItem("dtk.lastWorkspace", "trunc236"));
    await page.goto("/");

    const notice = page.locator("[data-workspace-skipped]");
    await expect(notice).toContainText("trunc236", { timeout: 30_000 });
    await expect(notice).toHaveAttribute("role", "status");
    await expect(notice).toContainText("unreadable");
    await expect(notice).toContainText("Delete it from the workspace list");
    await expect(page.getByLabel("Sources screen")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("dtk.lastWorkspace"))).not.toBe(
      "trunc236",
    );

    const item = page
      .getByLabel("Workspaces")
      .locator('.ws-item[data-workspace="trunc236"]');
    await expect(item.locator(".ws-corrupt-reason")).toBeVisible();
    await expect(item.locator(".ws-corrupt-reason")).toContainText("Unreadable");
    await expect(item.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
    await expect(item.getByRole("button", { name: "Rename", exact: true })).toBeDisabled();
    await expect(item.getByRole("button", { name: "Duplicate", exact: true })).toBeDisabled();
    await expectNoA11yViolations(page, "corrupt remembered workspace");

    await notice.getByRole("button", { name: "Dismiss" }).click();
    await expect(notice).toHaveCount(0);

    page.once("dialog", (d) => void d.accept());
    await item.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(item).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await request.delete(`${API}/workspaces/trunc236`);
  }
});
