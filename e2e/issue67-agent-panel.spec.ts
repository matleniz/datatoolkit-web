import { expect, test, type Page } from "@playwright/test";
import { openWorkbench } from "./helpers";

/**
 * datatoolkit-issues#67 — in-Studio agent panel with the engine's `stub` pack
 * (playwright.config.ts starts dtk-api with `DTK_AGENT_PACK=stub`): no
 * network, scripted tool calls through the real UI bridge.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/ui`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

const stepOps = (page: Page) =>
  page.evaluate(() => window.__DTK_STATE__?.()?.workspace?.steps.map((s) => s.op) ?? []);

async function openPanel(page: Page) {
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  await expect(panel.getByLabel("Message the agent")).toBeVisible({ timeout: 15_000 });
  return panel;
}

async function say(page: Page, text: string) {
  const panel = page.getByRole("complementary", { name: "Agent" });
  await panel.getByLabel("Message the agent").fill(text);
  await panel.getByRole("button", { name: "Send" }).click();
}

test.beforeEach(async ({ request }) => {
  const res = await request.get(`${API}/agent`, { headers: AUTH });
  test.skip(res.status() === 404, "engine without the agent chat routes (#67)");
  expect(((await res.json()) as { pack: string | null }).pack).toBe("stub");
});

test("issue 67: 'add a step' from the panel refreshes the grid, Undo restores", async ({ page }) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  const grid = page.getByLabel("Data grid");
  const before = await grid.getAttribute("data-identity-current");
  expect(before).toBeTruthy();

  const panel = await openPanel(page);
  await expect(panel.locator("[data-agent-usage]")).toHaveText(/in · .* out/);
  await say(page, "please add a step");

  // The user message, the tool chip (done), the reply, the usage line.
  await expect(panel.locator('[data-role="user"]')).toHaveText("please add a step");
  const chip = panel.locator('[data-tool-call="propose_steps"]');
  await expect(chip).toContainText("propose_steps · add scale");
  await expect(chip).toContainText("done", { timeout: 30_000 });
  await expect(panel.locator('[data-role="assistant"]').last()).not.toBeEmpty();
  await expect(panel.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator("[data-agent-usage]")).not.toHaveText("0 in · 0 out");

  // The step is in, the grid moved to the new frame.
  expect(await stepOps(page)).toEqual(["scale"]);
  await expect(grid).not.toHaveAttribute("data-identity-current", before!, { timeout: 30_000 });
  const after = await grid.getAttribute("data-identity-current");
  await expect(grid).toHaveAttribute("data-identity", after!, { timeout: 60_000 });

  // The chip links to the step it added (highlighted step card).
  await chip.getByRole("button").click();
  await expect(page.locator("[data-agent-touched]").first()).toBeVisible();

  // Undo (AgentBridge toast) -> back to the first frame.
  const toast = page.getByRole("status").filter({ hasText: "Agent: add scale (age)" });
  await toast.getByRole("button", { name: "Undo" }).click();
  expect(await stepOps(page)).toEqual([]);
  await expect(grid).toHaveAttribute("data-identity-current", before!, { timeout: 30_000 });
  await expect(grid).toHaveAttribute("data-identity", before!, { timeout: 60_000 });
});

test("issue 67: a permission request waits for Allow / Deny; Deny fails the call", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  const panel = await openPanel(page);
  await say(page, "ask for permission");

  const card = panel.getByRole("region", { name: "Agent permission request" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Deny" }).click();
  await expect(card).toContainText("Denied");
  await expect(panel.locator('[data-tool-call="propose_steps"]')).toContainText("failed", {
    timeout: 30_000,
  });
  await expect(panel.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 30_000 });
  expect(await stepOps(page)).toEqual([]);
});

test("issue 67: with no agent pack the panel says why and offers Check again", async ({ page }) => {
  await page.route("**/api/ui/agent", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            available: false,
            pack: null,
            reason: "no agent pack configured (DTK_AGENT_PACK)",
            running: false,
            usage: { input_tokens: 0, output_tokens: 0 },
            max_tokens: null,
          },
        })
      : route.continue(),
  );
  await openWorkbench(page, true);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  await expect(panel).toContainText("No agent");
  await expect(panel).toContainText("no agent pack configured (DTK_AGENT_PACK)");
  await expect(panel.getByRole("button", { name: "Check again" })).toBeVisible();
  await expect(panel.getByLabel("Message the agent")).toHaveCount(0);
});
