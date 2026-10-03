import { expect, test, type Page } from "@playwright/test";
import { openWorkbench } from "./helpers";

/**
 * datatoolkit-issues#115 — opt-in terminal panel. The engine's PTY route is
 * mocked with `page.routeWebSocket` (the stub engine has no terminal pack).
 */
const enc = (s: string) => Buffer.from(s);

/** `GET /api/ui/agent/options` is not on the stub engine yet: mock it. */
async function mockOptions(page: Page) {
  await page.route("**/api/ui/agent/options", (route) =>
    route.fulfill({
      json: {
        default: { pack: "stub", model: null },
        packs: [
          { id: "agent-sdk", title: "Claude (Agent SDK)", mode: "cli", panel: "chat", available: true, reason: null },
          { id: "claude-code", title: "Claude Code", mode: "cli", panel: "terminal", available: true, reason: null },
          { id: "gemini", title: "Gemini CLI", mode: "cli", panel: "terminal", available: true, reason: null },
        ],
      },
    }),
  );
}

async function start(page: Page, pack = "Claude Code") {
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Terminal" });
  await panel.getByLabel("Terminal pack").selectOption({ label: pack });
  await panel.getByRole("button", { name: "Start" }).click();
  return panel;
}

test("issue 115: open, see output, type, resize, close ends the session", async ({ page }) => {
  const received: unknown[] = [];
  let closed = false;
  let url = "";
  await page.routeWebSocket(/\/api\/ui\/terminal/, (ws) => {
    url = ws.url();
    ws.send(JSON.stringify({ type: "started", pack: "claude-code", model: null, command: ["claude"] }));
    ws.send(enc("hello from the pty\r\n$ "));
    ws.onMessage((m) => {
      if (typeof m !== "string") {
        // Binary = keystrokes; the mock PTY echoes them.
        received.push({ type: "input", data: m.toString() });
        ws.send(m);
        return;
      }
      received.push(JSON.parse(m));
    });
    ws.onClose(() => {
      closed = true;
    });
  });

  await mockOptions(page);
  await openWorkbench(page, true);
  await expect(page.getByRole("complementary", { name: "Terminal" })).toHaveCount(0);
  const panel = await start(page);
  await expect(panel.locator("[data-terminal-badge]")).toHaveText("weaker guarantee");
  await expect(panel).toContainText("claude-code");
  await expect(panel.locator(".xterm-rows")).toContainText("hello from the pty", { timeout: 15_000 });
  expect(url).toMatch(/\/api\/ui\/terminal\?.*pack=claude-code/);
  expect(url).toMatch(/cols=\d+&rows=\d+/);

  await panel.locator(".xterm").click();
  await page.keyboard.type("echo hi");
  await expect(panel.locator(".xterm-rows")).toContainText("echo hi");
  expect(received).toContainEqual({ type: "input", data: "e" });
  expect(received.some((f) => (f as { type: string }).type === "resize")).toBe(true);

  await panel.getByRole("button", { name: "Close terminal panel" }).click();
  await expect(page.getByRole("complementary", { name: "Terminal" })).toHaveCount(0);
  await expect.poll(() => closed).toBe(true);
});

test("issue 115: an exit shows the ended state and starts again", async ({ page }) => {
  // Not a connection counter: StrictMode mounts the effect twice in dev.
  let exits = true;
  await page.routeWebSocket(/\/api\/ui\/terminal/, (ws) => {
    ws.send(JSON.stringify({ type: "started", pack: "gemini", model: null, command: ["gemini"] }));
    if (exits) ws.send(JSON.stringify({ type: "exit", code: 0 }));
    else ws.send(enc("second session"));
  });
  await mockOptions(page);
  await openWorkbench(page, true);
  const panel = await start(page, "Gemini CLI");
  await expect(panel.locator('[data-terminal-state="ended"]')).toContainText("Session ended (exit code 0)");
  exits = false;
  await panel.getByRole("button", { name: "Start again" }).click();
  await expect(panel.locator(".xterm-rows")).toContainText("second session");
  await expect(panel.locator("[data-terminal-state]")).toHaveCount(0);
});

test("issue 115: a dropped socket offers Reconnect", async ({ page }) => {
  await page.routeWebSocket(/\/api\/ui\/terminal/, (ws) => {
    ws.close({ code: 4409 });
  });
  await mockOptions(page);
  await openWorkbench(page, true);
  const panel = await start(page);
  await expect(panel.locator('[data-terminal-state="dropped"]')).toContainText("already has a terminal");
  await expect(panel.getByRole("button", { name: "Reconnect" })).toBeVisible();
});
