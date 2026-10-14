import { expect, test } from "@playwright/test";
import { join } from "node:path";

import { fixturesDir, sourceFileInput } from "./helpers";

/**
 * #234: the Sources setup (uploaded file, role, target column) is stored as it
 * changes, so a reload keeps it without clicking "Open workbench".
 */
test("#234: upload + role + target survive a reload", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "+ New workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill("issue234_persist");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Sources of “issue234_persist”")).toBeVisible({
    timeout: 15_000,
  });

  await sourceFileInput(page).setInputFiles(join(fixturesDir, "churn_train.csv"));
  const filesList = page.getByRole("region", { name: "Files list" });
  const row = filesList.locator(".files-table-row", { hasText: "churn_train.csv" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: /Train X/ }).click();
  await expect(row.getByRole("button", { name: /Train X/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Column in train X" }).click();
  const planChip = page
    .getByRole("region", { name: "Target settings" })
    .getByRole("button", { name: "plan", exact: true });
  await planChip.click();

  // Autosave (debounced) must land on disk without leaving Sources.
  await expect
    .poll(
      async () => {
        const r = await request.get("/api/workspaces/issue234_persist");
        if (!r.ok()) return "";
        const ws = (await r.json()) as {
          datasets: { train: { x: { path: string }; target_column?: string } };
        };
        return `${ws.datasets.train.x.path ? "path" : "nopath"}:${ws.datasets.train.target_column ?? ""}`;
      },
      { timeout: 15_000 },
    )
    .toBe("path:plan");

  await page.reload();
  await expect(page.getByText("Sources of “issue234_persist”")).toBeVisible({
    timeout: 60_000,
  });
  const row2 = page
    .getByRole("region", { name: "Files list" })
    .locator(".files-table-row", { hasText: "churn_train.csv" });
  await expect(row2).toBeVisible({ timeout: 30_000 });
  await expect(row2.getByRole("button", { name: /Train X/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Column in train X" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByRole("region", { name: "Target settings" })
      .getByRole("button", { name: "plan", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await request.delete("/api/workspaces/issue234_persist");
});
