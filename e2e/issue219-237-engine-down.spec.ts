import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./a11y";

/**
 * datatoolkit-issues#219 / #237: engine-down startup screen with Retry, and the
 * workspace list saying the engine is unreachable (creation disabled).
 */
const BOOM = {
  status: 500,
  contentType: "application/json",
  body: JSON.stringify({ type: "Boom", message: "engine exploded (e2e)" }),
};

test("#219: failing /api/workspaces shows the error screen, Retry recovers", async ({ page }) => {
  test.setTimeout(120_000);
  const listUrl = /\/api\/workspaces$/;
  await page.route(listUrl, (route) => route.fulfill(BOOM));
  await page.goto("/");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("engine exploded (e2e)", { timeout: 30_000 });
  await expect(page.getByText("Start dtk-api on port 8765")).toBeVisible();
  // The app is not mounted on a failed state.
  await expect(page.getByLabel("Sources screen")).toHaveCount(0);
  await expectNoA11yViolations(page, "bootstrap engine-down");

  await page.unroute(listUrl);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("#237: list fetch failing says the engine is unreachable and disables creation", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const summariesUrl = /\/api\/workspaces\/summaries$/;
  await page.route(summariesUrl, (route) => route.abort());
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Engine unreachable: cannot list workspaces.")).toBeVisible();
  await expect(page.getByText("No workspaces yet.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ New workspace" })).toBeDisabled();

  // Engine back: Retry reloads the list and re-enables creation.
  await page.unroute(summariesUrl);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Engine unreachable: cannot list workspaces.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ New workspace" })).toBeEnabled();
});

test("#237: list recovers on window focus without Retry", async ({ page }) => {
  test.setTimeout(120_000);
  const summariesUrl = /\/api\/workspaces\/summaries$/;
  await page.route(summariesUrl, (route) => route.abort());
  await page.goto("/");
  await expect(page.getByText("Engine unreachable: cannot list workspaces.")).toBeVisible({
    timeout: 60_000,
  });
  await page.unroute(summariesUrl);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "+ New workspace" })).toBeEnabled();
});
