import { expect, test } from "@playwright/test";
import { openWorkbench } from "./helpers";

/**
 * datatoolkit-issues#115 — opt-in terminal panel. The engine's PTY route is
 * mocked with `page.routeWebSocket` (the stub engine has no terminal pack).
 */
const enc = (s: string) => Buffer.from(s);

test("issue 115: open, see output, type, resize, close ends the session", async ({ page }) => {
  const received: unknown[] = [];
  let closed = false;
  let url = "";
  await page.routeWebSocket(/\/api\/ui\/agent\/terminal/, (ws) => {
    url = ws.url();
    ws.send(JSON.stringify({ type: "ready", pack: "claude-code" }));
    ws.send(enc("hello from the pty\r\n$ "));
    ws.onMessage((m) => {
      const frame = JSON.parse(String(m));
      received.push(frame);
      if (frame.type === "input") ws.send(enc(frame.data));
    });
    ws.onClose(() => {
      closed = true;
    });
  });

  await openWorkbench(page, true);
  await expect(page.getByRole("complementary", { name: "Terminal" })).toHaveCount(0);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Terminal" });
  await expect(panel.locator("[data-terminal-badge]")).toHaveText("weaker guarantee");
  await expect(panel).toContainText("claude-code");
  await expect(panel.locator(".xterm-rows")).toContainText("hello from the pty", { timeout: 15_000 });
  expect(url).toMatch(/session=.+&token=/);

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
  await page.routeWebSocket(/\/api\/ui\/agent\/terminal/, (ws) => {
    ws.send(JSON.stringify({ type: "ready", pack: "gemini" }));
    if (exits) ws.send(JSON.stringify({ type: "exit", code: 0 }));
    else ws.send(enc("second session"));
  });
  await openWorkbench(page, true);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Terminal" });
  await expect(panel.locator('[data-terminal-state="ended"]')).toContainText("Session ended (exit code 0)");
  exits = false;
  await panel.getByRole("button", { name: "Start again" }).click();
  await expect(panel.locator(".xterm-rows")).toContainText("second session");
  await expect(panel.locator("[data-terminal-state]")).toHaveCount(0);
});

test("issue 115: a dropped socket offers Reconnect", async ({ page }) => {
  await page.routeWebSocket(/\/api\/ui\/agent\/terminal/, (ws) => {
    ws.close();
  });
  await openWorkbench(page, true);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Terminal" });
  await expect(panel.locator('[data-terminal-state="dropped"]')).toContainText("Connection lost");
  await expect(panel.getByRole("button", { name: "Reconnect" })).toBeVisible();
});
