import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { fixturesDir, openWorkbench } from "./helpers";

/**
 * datatoolkit-issues#129 — the session's attachments stay visible (and
 * detachable) after a send and across a panel close / reopen: the engine
 * keeps them and the agent can read any of them.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/ui`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

test.beforeEach(async ({ request }) => {
  const res = await request.get(`${API}/agent/attachments?session=probe`, { headers: AUTH });
  test.skip(res.status() === 404, "engine without the attachment routes (#121)");
});

test("issue 129: attached files survive send and panel close, detach empties the engine list", async ({ page, request }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  const sid = await page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);
  const engineList = async () => {
    const r = await request.get(`${API}/agent/attachments`, { headers: AUTH, params: { session: sid } });
    return ((await r.json()) as { name: string }[]).map((a) => a.name);
  };

  const agentButton = page.getByRole("button", { name: "Agent", exact: true });
  await agentButton.click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  await expect(panel.getByLabel("Message the agent")).toBeVisible({ timeout: 15_000 });

  await panel.locator("[data-attach-input]").setInputFiles(join(fixturesDir, "customers_extra.csv"));
  await expect(panel.locator("[data-attachment]")).toHaveAttribute("data-attachment", "ready", { timeout: 30_000 });
  // The chip is the one place it shows while the message is being written.
  await expect(panel.locator("[data-session-attachment]")).toHaveCount(0);

  await panel.getByLabel("Message the agent").fill("hello");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator("[data-attachment]")).toHaveCount(0);
  await expect(panel.locator("[data-msg-files]").first()).toContainText("customers_extra.csv");
  const listed = panel.locator("[data-session-attachment]");
  await expect(listed).toHaveCount(1);
  await expect(listed).toContainText("customers_extra.csv");

  await panel.getByRole("button", { name: "Close agent panel" }).click();
  await expect(panel).toHaveCount(0);
  await agentButton.click();
  await expect(listed).toHaveCount(1);
  expect(await engineList()).toEqual(["customers_extra.csv"]);

  await panel.getByRole("button", { name: "Detach customers_extra.csv" }).click();
  await expect(listed).toHaveCount(0);
  await expect.poll(engineList, { timeout: 15_000 }).toEqual([]);
});
