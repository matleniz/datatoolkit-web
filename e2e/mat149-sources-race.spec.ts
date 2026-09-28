import { expect, test, type Request } from "@playwright/test";
import { waitForGridReady } from "./helpers";

/**
 * MAT-149: selecting a workspace then navigating immediately must not PUT
 * empty datasets and must still open the workbench with the real sources.
 */
test("MAT-149: select workspace then Open workbench immediately keeps datasets", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Sources of “churn”")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page
      .getByRole("region", { name: "Files list" })
      .getByText("churn_train.csv"),
  ).toBeVisible({ timeout: 30_000 });

  // Snapshot on-disk churn before the race.
  const before = await request.get("/api/workspaces/churn");
  expect(before.ok()).toBeTruthy();
  const beforeWs = (await before.json()) as {
    datasets: { train: { x: { path: string } } };
  };
  const beforePath = beforeWs.datasets.train.x.path;
  expect(beforePath).toBeTruthy();

  // Create a second workspace so we can switch back to churn under load.
  await page.getByRole("button", { name: "+ New workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill("race_scratch");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Sources of “race_scratch”")).toBeVisible({
    timeout: 15_000,
  });

  const wipedPuts: string[] = [];
  const onReq = (r: Request) => {
    if (r.method() !== "PUT") return;
    if (!r.url().includes("/api/workspaces/churn")) return;
    const body = r.postData() ?? "";
    if (/"path"\s*:\s*""/.test(body)) {
      wipedPuts.push(body);
    }
  };
  page.on("request", onReq);

  // Race: select churn and click Open workbench with no intentional wait.
  // Playwright waits for the button to become enabled after sources load.
  await page
    .locator(".ws-item")
    .filter({ has: page.locator(".ws-item-name", { hasText: /^churn$/ }) })
    .click();
  await page.getByRole("button", { name: "Open workbench" }).click();

  await expect(page.getByLabel("Workbench")).toBeVisible({ timeout: 60_000 });
  await waitForGridReady(page);
  await expect(page.locator(".grid-th", { hasText: "age" })).toBeVisible({
    timeout: 30_000,
  });

  page.off("request", onReq);
  expect(wipedPuts, "must not PUT churn with empty train path").toEqual([]);

  const after = await request.get("/api/workspaces/churn");
  expect(after.ok()).toBeTruthy();
  const afterWs = (await after.json()) as {
    datasets: { train: { x: { path: string } } };
  };
  expect(afterWs.datasets.train.x.path).toBe(beforePath);
  expect(afterWs.datasets.train.x.path.length).toBeGreaterThan(0);
});
