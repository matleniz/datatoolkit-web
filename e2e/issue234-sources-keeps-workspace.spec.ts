import { expect, test, type Page } from "@playwright/test";

import type { Workspace } from "../src/api/types";
import { churnWorkspace, openWorkbench } from "./helpers";

const goSources = async (page: Page) => {
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({ type: "SET_SCREEN", screen: "sources" }),
  );
  await expect(page.getByLabel("Sources screen")).toBeVisible();
  // Let the Sources files load and the sync effect run.
  await expect(
    page
      .getByRole("region", { name: "Files list" })
      .getByText("churn_train.csv"),
  ).toBeVisible({ timeout: 30_000 });
};

const settled = (page: Page) =>
  page.waitForFunction(async () => {
    await window.__DTK_WORKSPACE_SAVED__;
    return true;
  });

/** #234 review: Sources only owns datasets / label / merges. */
test("#234: opening Sources without an edit keeps variables, memory, counters", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  const ws: Workspace = {
    ...churnWorkspace(),
    variables: [{ name: "avg_age", stat: "mean", column: "age" }],
    memory: [
      { id: "m3", text: "keep me", kind: "fact" },
    ],
    id_counters: { m: 3, d: 0 },
  };
  await page.evaluate(
    (workspace) =>
      window.__DTK_DISPATCH__!({ type: "SET_WORKSPACE", workspace }),
    ws,
  );
  await settled(page);
  // The seed itself is on disk before Sources is opened.
  await expect
    .poll(
      async () =>
        (
          (await (await request.get("/api/workspaces/churn")).json()) as Workspace
        ).variables,
      { timeout: 15_000 },
    )
    .toEqual(ws.variables);

  await goSources(page);
  // Any save the Sources sync effect starts is gated by __DTK_WORKSPACE_SAVED__.
  await settled(page);
  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });

  const r = await request.get("/api/workspaces/churn");
  const disk = (await r.json()) as Workspace;
  expect(disk.variables).toEqual(ws.variables);
  expect(disk.memory?.map((m) => m.id)).toEqual(["m3"]);
  expect(disk.id_counters).toMatchObject({ m: 3 });
});

test("#234: a Sources role change keeps the step undo history", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({
      type: "ADD_STEP",
      step: {
        op: "impute",
        target: "both",
        params: { columns: ["age"], strategy: "median" },
      },
    }),
  );
  await expect(page.locator(".pipeline-node", { hasText: "Impute" })).toHaveCount(1);

  await goSources(page);
  const row = page
    .getByRole("region", { name: "Files list" })
    .locator(".files-table-row", { hasText: "customers_extra.csv" });
  await row.getByRole("button", { name: /Ignore/ }).click();
  await expect(row.getByRole("button", { name: /Ignore/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await settled(page);

  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({ type: "SET_SCREEN", screen: "bench" }),
  );
  const undo = page.getByRole("button", { name: "Undo pipeline change" });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(page.locator(".pipeline-node", { hasText: "Impute" })).toHaveCount(0);
});
