import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectNoA11yViolations } from "./a11y";

/**
 * datatoolkit-issues#262: the remembered workspace is corrupt and the engine
 * refuses to open every other one. The startup error screen names the skipped
 * workspace, and keeps naming it after Retry (which no longer knows the name).
 * Runs on the real engine; the refusals are route interceptions.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api`;

test("#262: error screen keeps the skipped workspace name across Retry", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const home = process.env.DTK_E2E_HOME;
  if (!home) throw new Error("DTK_E2E_HOME is not set by playwright.config");
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });

  const put = await request.put(`${API}/workspaces/trunc262`, {
    data: {
      name: "trunc262",
      datasets: { train: { x: { kind: "csv", path: "/tmp/none.csv" } } },
      label: { mode: "order" },
      merges: [],
      variables: [],
      steps: [],
    },
  });
  expect(put.ok()).toBeTruthy();
  const file = join(home, "workspaces", "trunc262.json");
  const body = readFileSync(file, "utf-8");
  writeFileSync(file, body.slice(0, Math.floor(body.length / 2)), "utf-8");

  const openUrl = /\/api\/workspaces\/(?!summaries$)[^/]+$/;
  const refuse = (route: import("@playwright/test").Route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ type: "Boom", message: "cannot open (e2e)" }),
        })
      : route.fallback();

  try {
    await page.route(openUrl, refuse);
    await page.addInitScript(() => {
      // Only the first load: a Retry must not rely on the remembered name.
      if (!sessionStorage.getItem("seeded262")) {
        sessionStorage.setItem("seeded262", "1");
        localStorage.setItem("dtk.lastWorkspace", "trunc262");
      }
    });
    await page.goto("/");

    const notice = page.locator("[data-workspace-skipped]");
    await expect(page.getByText("Cannot reach the engine")).toBeVisible({ timeout: 30_000 });
    await expect(notice).toHaveAttribute("data-workspace-skipped", "trunc262");
    await expect(notice).toContainText("unreadable");
    await expect(page.getByLabel("Sources screen")).toHaveCount(0);
    await expectNoA11yViolations(page, "bootstrap error with skipped workspace");

    // Retry while the engine still refuses: same screen, still the name.
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Cannot reach the engine")).toBeVisible();
    await expect(notice).toHaveAttribute("data-workspace-skipped", "trunc262");

    // Engine recovers: the app opens and the notice is still shown.
    await page.unroute(openUrl, refuse);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
    await expect(notice).toHaveAttribute("data-workspace-skipped", "trunc262");
    await notice.getByRole("button", { name: "Dismiss" }).click();
    await expect(notice).toHaveCount(0);
  } finally {
    await request.delete(`${API}/workspaces/trunc262`);
  }
});

/**
 * #243: a failure on workspace B must not erase the "edits to A were lost"
 * notice; both stay until dismissed, one at a time.
 */
test("#243: orphaned notices of several workspaces coexist and dismiss one by one", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
  const churn = (await (await request.get(`${API}/workspaces/churn`)).json()) as Record<string, unknown>;
  for (const n of ["a243", "b243", "c243"]) {
    const r = await request.put(`${API}/workspaces/${n}`, { data: { ...churn, name: n } });
    expect(r.ok()).toBeTruthy();
  }
  try {
    // The list is read at load: reload so the sidebar shows the three new ones.
    await page.reload();
    await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
    await page.route(/\/api\/workspaces\/[abc]243$/, (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ type: "EngineUnavailable", message: "unavailable (e2e)" }),
          })
        : route.fallback(),
    );
    const sidebar = page.getByLabel("Workspaces");
    const open = async (n: string) => {
      await sidebar.locator(`.ws-item[data-workspace="${n}"] .ws-item-select`).click();
      await expect
        .poll(() => page.evaluate(() => window.__DTK_STATE__!().workspace?.name))
        .toBe(n);
    };
    const edit = async (id: string) => {
      await page.evaluate(
        (stepId) =>
          window.__DTK_DISPATCH__!({
            type: "ADD_STEP",
            step: { id: stepId, op: "drop_columns", target: "both", params: { columns: ["signup_date"] } },
          }),
        id,
      );
    };
    const live = page.locator('[data-save-failed=""]');
    const lost = page.locator('[data-save-failed="orphaned"]');

    await open("a243");
    await edit("s243a");
    await expect(live).toContainText("unavailable (e2e)", { timeout: 15_000 });
    await open("b243");
    await expect(lost).toHaveCount(1);
    await edit("s243b");
    await expect(live).toContainText("unavailable (e2e)", { timeout: 15_000 });
    // B's failure does not replace A's notice.
    await expect(lost).toHaveCount(1);
    await expect(lost.first()).toContainText("a243");
    await open("c243");
    await expect(lost).toHaveCount(2);
    await expect(lost.nth(0)).toContainText("a243");
    await expect(lost.nth(1)).toContainText("b243");
    await expectNoA11yViolations(page, "two orphaned save notices (#243)");

    await lost.nth(0).getByRole("button", { name: "Dismiss" }).click();
    await expect(lost).toHaveCount(1);
    await expect(lost.first()).toContainText("b243");
    await lost.first().getByRole("button", { name: "Dismiss" }).click();
    await expect(lost).toHaveCount(0);
  } finally {
    for (const n of ["a243", "b243", "c243"]) await request.delete(`${API}/workspaces/${n}`);
  }
});
