import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { fixturesDir, openWorkbench } from "./helpers";

/**
 * datatoolkit-issues#116 — attach files to the agent chat (stub pack). The
 * file goes through PUT /api/uploads/{filename}; the workspace sources, label
 * and merges stay untouched.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/ui`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

test.beforeEach(async ({ request }) => {
  const res = await request.get(`${API}/agent`, { headers: AUTH });
  test.skip(res.status() === 404, "engine without the agent chat routes (#67)");
});

test("issue 116: attach a CSV, chip ready, send carries it, sources unchanged", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  const sourcesOf = () =>
    page.evaluate(() => JSON.stringify(window.__DTK_STATE__?.()?.workspace?.sources ?? null));
  const before = await sourcesOf();

  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  await expect(panel.getByLabel("Message the agent")).toBeVisible({ timeout: 15_000 });

  await panel.locator("[data-attach-input]").setInputFiles(join(fixturesDir, "customers_extra.csv"));
  const chip = panel.locator("[data-attachment]");
  await expect(chip).toHaveAttribute("data-attachment", "ready", { timeout: 30_000 });
  await expect(chip).toContainText("customers_extra.csv");

  const sent = page.waitForRequest((r) => r.url().endsWith("/ui/agent/send") && r.method() === "POST");
  await panel.getByLabel("Message the agent").fill("please add a step");
  await panel.getByRole("button", { name: "Send" }).click();
  const body = (await sent).postDataJSON() as {
    attachments?: { name: string; path: string }[];
  };
  expect(body.attachments).toHaveLength(1);
  expect(body.attachments?.[0].name).toBe("customers_extra.csv");
  await expect(panel.locator("[data-attachment]")).toHaveCount(0);

  await expect(panel.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 30_000 });
  expect(await sourcesOf()).toBe(before);
});
