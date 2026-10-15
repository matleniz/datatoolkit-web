import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Workspace } from "../src/api/types";
import { openWorkbench } from "./helpers";

/**
 * datatoolkit-issues#218 — a failed autosave PUT shows a persistent
 * "Not saved: <engine message> — Retry" notice; Retry re-sends the latest
 * workspace and clears it, and the edit is on disk.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api`;

async function stored(request: APIRequestContext): Promise<Workspace> {
  return (await (await request.get(`${API}/workspaces/churn`)).json()) as Workspace;
}

test("issue 218: failed autosave is shown and Retry saves", async ({ page, request }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);

  let reject = true;
  await page.route(/\/api\/workspaces\/churn$/, async (route) => {
    if (route.request().method() === "PUT" && reject) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ type: "EngineUnavailable", message: "engine unavailable (e2e)" }),
      });
      return;
    }
    await route.continue();
  });

  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({
      type: "ADD_STEP",
      step: { op: "drop_columns", target: "both", params: { columns: ["signup_date"] } },
    }),
  );

  const banner = page.locator("[data-save-failed]");
  await expect(banner).toContainText("Not saved:", { timeout: 15_000 });
  await expect(banner).toContainText("engine unavailable (e2e)");
  expect((await stored(request)).steps).toHaveLength(0);

  reject = false;
  await banner.getByRole("button", { name: "Retry" }).click();
  await expect(banner).toHaveCount(0);
  expect((await stored(request)).steps.map((s) => s.op)).toEqual(["drop_columns"]);
});

test("issue 218: reverting to the saved workspace clears the notice", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  await page.route(/\/api\/workspaces\/churn$/, async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ type: "ValidationError", message: "rejected (e2e)" }),
      });
      return;
    }
    await route.continue();
  });
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({
      type: "ADD_STEP",
      step: { op: "drop_columns", target: "both", params: { columns: ["signup_date"] } },
    }),
  );
  const banner = page.locator("[data-save-failed]");
  await expect(banner).toContainText("rejected (e2e)", { timeout: 15_000 });
  await page.evaluate(() => window.__DTK_DISPATCH__!({ type: "UNDO_STEPS" }));
  await expect(banner).toHaveCount(0);
});
