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
  await expect(panel.locator("[data-agent-usage]")).toHaveText(/in · cache .* write \/ .* read · .* out/);
  await expect(panel.locator("[data-agent-usage-turn]")).toHaveCount(0);
  await say(page, "please add a step");

  // The user message, the tool chip (done), the reply, the usage line.
  await expect(panel.locator('[data-role="user"]')).toHaveText("please add a step");
  const chip = panel.locator('[data-tool-call="propose_steps"]');
  await expect(chip).toContainText("propose_steps · add scale");
  await expect(chip).toContainText("done", { timeout: 30_000 });
  await expect(panel.locator('[data-role="assistant"]').last()).not.toBeEmpty();
  await expect(panel.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 30_000 });
  // #151: cumulative and last-turn usage, cache split apart (the stub reports no cache).
  await expect(panel.locator("[data-agent-usage]")).not.toHaveText(/^0 in · cache 0 write \/ 0 read · 0 out/);
  await expect(panel.locator("[data-agent-usage-turn]")).toHaveText(
    /^last turn: \d+ in · cache 0 write \/ 0 read · \d+ out/,
  );

  // The step is in, the grid moved to the new frame.
  expect(await stepOps(page)).toEqual(["scale"]);
  await expect(grid).not.toHaveAttribute("data-identity-current", before!, { timeout: 30_000 });
  const after = await grid.getAttribute("data-identity-current");
  await expect(grid).toHaveAttribute("data-identity", after!, { timeout: 60_000 });

  // #113: collapsed by default; expanding shows the input and the result.
  const toggle = chip.getByRole("button", { name: /propose_steps/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(chip.getByText("Input", { exact: true })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(chip.getByText("Input", { exact: true })).toBeVisible();
  await expect(chip.locator(".agent-kv-key", { hasText: "ops:" })).toBeVisible();
  await expect(chip.getByText("Output", { exact: true })).toBeVisible();
  await expect(chip.locator(".agent-chip-body")).toContainText("scale");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // The chip links to the step it added (highlighted step card).
  await chip.getByRole("button", { name: "Show" }).click();
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

/** #104: a destructive proposal waits for review past the command timeout; chip, context and status agree. */
test("issue 104: 'drop' waits for review, Apply after the timeout, the chip and command status say applied", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  const panel = await openPanel(page);
  await say(page, "drop support_calls");

  // The call returns at once: pending chip, the reply says so, the turn ends.
  const chip = panel.locator('[data-tool-call="propose_steps"]');
  await expect(chip).toContainText("propose_steps · add drop_columns");
  await expect(chip).toContainText("waiting for your review in Studio", { timeout: 15_000 });
  await expect(panel.locator('[data-role="assistant"]').last())
    .toHaveText("stub: waiting for your review in Studio");
  await expect(panel.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 15_000 });
  const review = page.getByLabel("Agent proposal");
  await expect(review).toContainText("drop_columns (support_calls)");

  // The UI context lists the open review with its command id.
  const sid = await page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);
  let command = "";
  await expect.poll(async () => {
    const res = await request.get(`${API}/context`, { headers: AUTH, params: { session: sid } });
    const ctx = (await res.json()) as { reviews?: { command: string; summary: string }[] };
    command = ctx.reviews?.[0]?.command ?? "";
    return ctx.reviews?.[0]?.summary;
  }, { timeout: 15_000 }).toBe("add drop_columns (support_calls)");
  const status = async () =>
    (await (await request.get(`${API}/commands/${command}`, { headers: AUTH })).json()) as Record<string, unknown>;
  expect(await status()).toEqual({ id: command, ok: null, pending: "review" });

  // Past the 30 s command timeout: still under review, not timed out.
  await page.waitForTimeout(31_000);
  await expect(chip).toContainText("waiting for your review in Studio");
  expect(await status()).toMatchObject({ ok: null, pending: "review" });

  await review.getByRole("button", { name: "Apply" }).click();
  await expect(chip).toContainText("applied after your review", { timeout: 15_000 });
  expect(await status()).toMatchObject({ id: command, ok: true });
  expect(await stepOps(page)).toEqual(["drop_columns"]);
  await expect.poll(async () => {
    const res = await request.get(`${API}/context`, { headers: AUTH, params: { session: sid } });
    return ((await res.json()) as { reviews: unknown[] }).reviews;
  }, { timeout: 15_000 }).toEqual([]);
});

/** #104: Dismiss turns the chip to "dismissed" and the command status to rejected. */
test("issue 104: Dismiss marks the chip dismissed, status rejected", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  const panel = await openPanel(page);
  await say(page, "drop support_calls");
  const chip = panel.locator('[data-tool-call="propose_steps"]');
  await expect(chip).toContainText("waiting for your review in Studio", { timeout: 15_000 });
  await page.getByLabel("Agent proposal").getByRole("button", { name: "Dismiss" }).click();
  await expect(chip).toContainText("dismissed in Studio", { timeout: 15_000 });
  expect(await stepOps(page)).toEqual([]);
});

test("issue 145: a Markdown table header in a reply is readable", async ({ page }) => {
  await openWorkbench(page);
  const panel = await openPanel(page);
  // The stub pack echoes "stub: <text>"; the blank line keeps the table apart.
  await say(page, "table\n\n| col | n |\n|---|---|\n| age | 1 |");
  const th = panel.locator(".agent-md th").first();
  await expect(th).toHaveText("col", { timeout: 15_000 });
  const style = await th.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, background: cs.backgroundColor };
  });
  expect(style.color).not.toBe(style.background);
  // Dark ink on a light header, not on the near-black code background.
  const luminance = (rgb: string) => {
    const [r = 0, g = 0, b = 0] = (rgb.match(/\d+/g) ?? []).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  expect(luminance(style.background) - luminance(style.color)).toBeGreaterThan(128);
});

test("issue 67: with no agent pack the panel says why and offers Check again", async ({ page }) => {
  await page.route(/\/api\/ui\/agent(\?.*)?$/, (route) =>
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
  await expect(panel).toContainText("a logged-in claude CLI");
  await expect(panel.getByRole("button", { name: "Check again" })).toBeVisible();
  await expect(panel.getByLabel("Message the agent")).toHaveCount(0);
});

test("issue 107: pack on but the CLI logged out shows the engine reason only", async ({ page }) => {
  await page.route(/\/api\/ui\/agent(\?.*)?$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            available: false,
            pack: "agent-sdk",
            reason: "claude CLI not logged in: run `claude` and /login, or set ANTHROPIC_API_KEY",
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
  await expect(panel).toContainText("claude CLI not logged in");
  await expect(panel).not.toContainText("Start it with");
});

/** #114: the selector reads GET /api/ui/agent/options and POSTs the choice (mocked until the engine stub serves it). */
test("issue 114: mode / pack / model selector, unavailable packs disabled, choice posted", async ({ page }) => {
  const status = (pack: string, title: string, mode: string, model: string | null) => ({
    available: true, pack, title, mode, panel: "chat", provider: "test provider", model,
    running: false, usage: { input_tokens: 0, output_tokens: 0 }, max_tokens: null,
  });
  let current = status("agent-sdk", "Claude (Agent SDK)", "cli", null);
  const posted: unknown[] = [];
  await page.route(/\/api\/ui\/agent(\?.*)?$/, (route) => route.fulfill({ json: current }));
  await page.route("**/api/ui/agent/options*", (route) =>
    route.fulfill({
      json: {
        default: { pack: "agent-sdk", model: null },
        packs: [
          { id: "agent-sdk", title: "Claude (Agent SDK)", mode: "cli", panel: "chat", available: true, default_model: null,
            models: [{ id: "sonnet", label: "Sonnet 5.5" }, { id: "opus", label: "Opus 5.5" }], model_free_text: false },
          { id: "api-anthropic", title: "Anthropic API", mode: "api", panel: "chat", available: true, default_model: null,
            models: [{ id: "claude-sonnet-5-5", label: "claude-sonnet-5-5" }], model_free_text: false },
          { id: "api-openai", title: "OpenAI-compatible", mode: "api", panel: "chat", available: false,
            reason: "DTK_OPENAI_BASE_URL is not set", models: [], model_free_text: true },
          { id: "claude-code", title: "Claude Code", mode: "cli", panel: "terminal", available: false,
            reason: "terminal off: set DTK_AGENT_TERMINAL=1", models: [], model_free_text: false },
        ],
      },
    }),
  );
  await page.route("**/api/ui/agent/config", (route) => {
    const body = route.request().postDataJSON() as { pack: string; model: string | null };
    posted.push(body);
    current = status(body.pack, body.pack === "api-anthropic" ? "Anthropic API" : "Claude (Agent SDK)",
      body.pack === "api-anthropic" ? "api" : "cli", body.model);
    return route.fulfill({ json: current });
  });

  await openWorkbench(page, true);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  const mode = panel.getByLabel("Agent mode", { exact: true });
  const pack = panel.getByLabel("Agent pack", { exact: true });
  const model = panel.getByLabel("Agent model", { exact: true });
  await expect(mode).toHaveValue("cli");
  await expect(pack).toHaveValue("agent-sdk");
  await expect(panel.locator("[data-agent-who]")).toContainText("Claude (Agent SDK)");

  // Unavailable / terminal packs are listed disabled, with their reason.
  await expect(pack.locator('option[value="claude-code"]')).toHaveAttribute("disabled", "");
  await expect(pack.locator('option[value="claude-code"]')).toContainText("weaker guarantee");

  await model.selectOption("opus");
  await expect.poll(() => posted.at(-1)).toEqual(expect.objectContaining({ pack: "agent-sdk", model: "opus" }));
  await expect(panel.locator("[data-agent-who]")).toContainText("opus");

  await mode.selectOption("api");
  await expect.poll(() => posted.at(-1)).toEqual(expect.objectContaining({ pack: "api-anthropic", model: null }));
  await expect(pack).toHaveValue("api-anthropic");
  await expect(pack.locator('option[value="api-openai"]')).toHaveAttribute("disabled", "");
  await expect(pack.locator('option[value="api-openai"]')).toContainText("DTK_OPENAI_BASE_URL is not set");
});

test("issue 114: an engine without the options route keeps no selector", async ({ page }) => {
  await page.route("**/api/ui/agent/options*", (route) => route.fulfill({ status: 404, json: { detail: "Not Found" } }));
  await openWorkbench(page, true);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  await expect(panel.getByLabel("Message the agent")).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator("[data-agent-picker]")).toHaveCount(0);
});
