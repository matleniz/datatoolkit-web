import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { fixturesDir } from "./helpers";

/**
 * datatoolkit-issues#76: Sources → Target → "By key column" shows the key
 * (chips of the common columns) and reports matched / lost labels.
 */
test("#76: By key column picks a key and reports matched labels", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const name = "issue76_keyjoin";
  const res = await request.put(`/api/workspaces/${name}`, {
    data: {
      name,
      datasets: {
        train: {
          x: { kind: "csv", path: join(fixturesDir, "keyjoin_x.csv") },
          y: { kind: "csv", path: join(fixturesDir, "keyjoin_y.csv") },
        },
      },
      label: { mode: "order" },
      merges: [],
      variables: [],
      steps: [],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
  await page
    .locator(`.ws-item[data-workspace="${name}"]`)
    .locator(".ws-item-select")
    .click();
  await expect(page.getByText(`Sources of “${name}”`)).toBeVisible({
    timeout: 30_000,
  });

  const target = page.getByRole("region", { name: "Target settings" });
  await target.getByRole("button", { name: "By key column" }).click();

  // Default key = first id-like common column; y has 8 of the 10 train rows.
  const picker = target.getByTestId("join-key-picker");
  await expect(picker.getByRole("button", { name: "row_id" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(picker.getByRole("button", { name: "patient_id" })).toBeVisible();
  const info = target.locator(".label-info");
  await expect(info).toContainText("8 / 8 labels matched on row_id", {
    timeout: 30_000,
  });
  await expect(info).toContainText("0 lost");
  await expect(info).toContainText("2 train rows without a label");

  // Change the key: the report follows.
  await picker.getByRole("button", { name: "patient_id" }).click();
  await expect(picker.getByRole("button", { name: "patient_id" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(info).toContainText("labels matched on patient_id", {
    timeout: 30_000,
  });
});
