import { expect, test } from "@playwright/test";

/**
 * datatoolkit-issues#220: when GET of the remembered workspace fails, Studio
 * forgets it, opens another workspace and names the skipped one.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api`;

test("#220: failing remembered workspace falls back and says why", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });

  const put = await request.put(`${API}/workspaces/flaky220`, {
    data: {
      name: "flaky220",
      datasets: { train: { x: { kind: "csv", path: "/tmp/none.csv" } } },
      label: { mode: "order" },
      merges: [],
      variables: [],
      steps: [],
    },
  });
  expect(put.ok()).toBeTruthy();

  try {
    await page.evaluate(() => localStorage.setItem("dtk.lastWorkspace", "flaky220"));
    let gets = 0;
    await page.route(/\/api\/workspaces\/flaky220$/, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      gets += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ type: "Boom", message: "disk exploded (e2e)" }),
      });
    });
    await page.reload();

    const notice = page.locator("[data-workspace-skipped]");
    await expect(notice).toContainText("flaky220", { timeout: 30_000 });
    await expect(notice).toContainText("disk exploded (e2e)");
    await expect(page.getByLabel("Sources screen")).toBeVisible();
    expect(gets).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("dtk.lastWorkspace"))).toBe("churn");
  } finally {
    await request.delete(`${API}/workspaces/flaky220`);
  }
});
