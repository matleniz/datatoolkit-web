import { expect, test, type Request } from "@playwright/test";
import { join } from "node:path";

import { churnWorkspace, fixturesDir } from "./helpers";

/**
 * MAT-171: workspace manager — create two workspaces, duplicate one, rename
 * it, delete both originals; list and active selection stay consistent after
 * reload. Also asserts deleting the active workspace does not PUT it back
 * (MAT-149 race).
 */
test("MAT-171: manage workspaces (duplicate, rename, delete, reload)", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const base = churnWorkspace();
  const seed = (name: string, steps: typeof base.steps = []) => ({
    ...base,
    name,
    steps,
    datasets: {
      ...base.datasets,
      train: {
        ...base.datasets.train,
        x: {
          ...base.datasets.train.x,
          path: join(fixturesDir, "churn_train.csv"),
        },
        y: base.datasets.train.y
          ? {
              ...base.datasets.train.y,
              path: join(fixturesDir, "churn_labels.csv"),
            }
          : null,
      },
      test: base.datasets.test
        ? {
            ...base.datasets.test,
            x: {
              ...base.datasets.test.x,
              path: join(fixturesDir, "churn_test.csv"),
            },
          }
        : null,
    },
    merges: base.merges.map((m) => ({
      ...m,
      source: {
        ...m.source,
        path: join(fixturesDir, "customers_extra.csv"),
      },
    })),
  });

  const a = seed("mat171_a");
  const b = seed("mat171_b", [
    {
      op: "drop_columns",
      target: "both",
      params: { columns: ["tenure"] },
    },
  ]);

  for (const ws of [a, b]) {
    const res = await request.put(`/api/workspaces/${ws.name}`, { data: ws });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({
    timeout: 60_000,
  });

  const sidebar = page.getByLabel("Workspaces");
  await expect(
    sidebar.locator('.ws-item[data-workspace="mat171_a"]'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    sidebar.locator('.ws-item[data-workspace="mat171_b"]'),
  ).toBeVisible();

  const itemB = sidebar.locator('.ws-item[data-workspace="mat171_b"]');
  await expect(itemB).toContainText(/1 step/);
  await expect(itemB).toContainText(/churn_train/);

  // Duplicate mat171_a → mat171_a-copy
  await sidebar
    .locator('.ws-item[data-workspace="mat171_a"]')
    .getByRole("button", { name: "Duplicate" })
    .click();
  await expect(
    sidebar.locator('.ws-item[data-workspace="mat171_a-copy"]'),
  ).toBeVisible({ timeout: 15_000 });

  // Rename the duplicate → mat171_dup
  const dupItem = sidebar.locator('.ws-item[data-workspace="mat171_a-copy"]');
  await dupItem.getByRole("button", { name: "Rename" }).click();
  const renameInput = dupItem.getByLabel("Rename mat171_a-copy");
  await renameInput.fill("mat171_dup");
  await renameInput.press("Enter");
  await expect(
    sidebar.locator('.ws-item[data-workspace="mat171_dup"]'),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    sidebar.locator('.ws-item[data-workspace="mat171_a-copy"]'),
  ).toHaveCount(0);

  // Select mat171_a (make it active), then multi-delete both originals.
  await sidebar
    .locator('.ws-item[data-workspace="mat171_a"]')
    .locator(".ws-item-select")
    .click();
  await expect(page.getByText("Sources of “mat171_a”")).toBeVisible({
    timeout: 30_000,
  });

  const resurrectedPuts: string[] = [];
  const onReq = (r: Request) => {
    if (r.method() !== "PUT") return;
    if (
      /\/api\/workspaces\/mat171_[ab](?:\/|$|\?)/.test(r.url())
    ) {
      resurrectedPuts.push(r.url());
    }
  };
  page.on("request", onReq);

  page.once("dialog", (d) => d.accept());
  await sidebar
    .locator('.ws-item[data-workspace="mat171_a"]')
    .getByLabel("Select mat171_a")
    .check();
  await sidebar
    .locator('.ws-item[data-workspace="mat171_b"]')
    .getByLabel("Select mat171_b")
    .check();
  await sidebar.getByRole("button", { name: "Delete selected" }).click();

  await expect(
    sidebar.locator('.ws-item[data-workspace="mat171_a"]'),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(
    sidebar.locator('.ws-item[data-workspace="mat171_b"]'),
  ).toHaveCount(0);
  await expect(
    sidebar.locator('.ws-item[data-workspace="mat171_dup"]'),
  ).toBeVisible();

  // Active fell back cleanly (not stuck on a deleted name).
  await expect(page.locator(".sources-title")).toBeVisible({
    timeout: 30_000,
  });
  const title = await page.locator(".sources-title").innerText();
  expect(title).not.toMatch(/mat171_a|mat171_b/);

  page.off("request", onReq);
  expect(
    resurrectedPuts,
    "must not PUT a deleted workspace back",
  ).toEqual([]);

  // Reload: list + active selection stay consistent.
  await page.reload();
  await expect(page.getByLabel("Sources screen")).toBeVisible({
    timeout: 60_000,
  });
  const sidebar2 = page.getByLabel("Workspaces");
  await expect(
    sidebar2.locator('.ws-item[data-workspace="mat171_dup"]'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    sidebar2.locator('.ws-item[data-workspace="mat171_a"]'),
  ).toHaveCount(0);
  await expect(
    sidebar2.locator('.ws-item[data-workspace="mat171_b"]'),
  ).toHaveCount(0);

  const summaries = await request.get("/api/workspaces/summaries");
  expect(summaries.ok()).toBeTruthy();
  const body = (await summaries.json()) as { name: string }[];
  const names = body.map((s) => s.name);
  expect(names).toContain("mat171_dup");
  expect(names).not.toContain("mat171_a");
  expect(names).not.toContain("mat171_b");
});
