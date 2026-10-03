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

let engineHasAttachments = true;

test.beforeEach(async ({ request }) => {
  const res = await request.get(`${API}/agent`, { headers: AUTH });
  test.skip(res.status() === 404, "engine without the agent chat routes (#67)");
  const att = await request.get(`${API}/agent/attachments?session=probe`, { headers: AUTH });
  // Until the engine ships #121 the registration routes are mocked in the test.
  engineHasAttachments = att.status() !== 404;
});

test("issue 116: attach a CSV, chip ready, send carries it, sources unchanged", async ({ page }) => {
  test.setTimeout(120_000);
  if (!engineHasAttachments) {
    await page.route("**/api/ui/agent/attachments**", (route) =>
      route.fulfill({ json: { id: "a1", name: "customers_extra.csv", kind: "table" } }),
    );
  }
  await openWorkbench(page, true);
  const datasetsOf = () =>
    page.evaluate(() => JSON.stringify(window.__DTK_STATE__?.()?.workspace?.datasets ?? null));
  const before = await datasetsOf();

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
    attachments?: string[];
  };
  expect(body.attachments).toHaveLength(1);
  expect(typeof body.attachments?.[0]).toBe("string");
  await expect(panel.locator("[data-attachment]")).toHaveCount(0);

  await expect(panel.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 30_000 });
  expect(await datasetsOf()).toBe(before);
  expect(before).not.toBe("null");
});

test("issue 128: a chip removed while uploading is not left attached to the session", async ({ page, request }) => {
  test.setTimeout(120_000);
  test.skip(!engineHasAttachments, "engine without the attachment routes (#121)");
  // Hold the registration until the chip is gone: the engine registers the
  // file, then Studio must detach it.
  let release: () => void = () => undefined;
  const removed = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/ui/agent/attachments", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await removed;
    await route.continue();
  });
  await openWorkbench(page, true);
  const sid = await page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);

  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  await expect(panel.getByLabel("Message the agent")).toBeVisible({ timeout: 15_000 });

  const registered = page.waitForResponse(
    (r) => r.url().includes("/ui/agent/attachments") && r.request().method() === "POST",
  );
  await panel.locator("[data-attach-input]").setInputFiles(join(fixturesDir, "customers_extra.csv"));
  await expect(panel.locator("[data-attachment]")).toHaveAttribute("data-attachment", "uploading");
  await panel.getByRole("button", { name: "Remove customers_extra.csv" }).click();
  await expect(panel.locator("[data-attachment]")).toHaveCount(0);
  release();
  expect((await registered).ok()).toBe(true);

  await expect
    .poll(async () => {
      const r = await request.get(`${API}/agent/attachments`, { headers: AUTH, params: { session: sid } });
      return r.ok() ? ((await r.json()) as unknown[]).length : -1;
    }, { timeout: 15_000 })
    .toBe(0);
  await expect(panel.locator("[data-attachment]")).toHaveCount(0);
});
