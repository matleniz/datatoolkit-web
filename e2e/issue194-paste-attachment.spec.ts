import { expect, test } from "@playwright/test";
import { openWorkbench } from "./helpers";

/** datatoolkit-issues#194 — a long paste becomes a text chat attachment (stub pack). */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/ui`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

async function paste(page: import("@playwright/test").Page, text: string): Promise<boolean> {
  return page.getByLabel("Message the agent").evaluate((el, t) => {
    const data = new DataTransfer();
    data.setData("text/plain", t);
    return el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test.beforeEach(async ({ request }) => {
  const res = await request.get(`${API}/agent`, { headers: AUTH });
  test.skip(res.status() === 404, "engine without the agent chat routes (#67)");
  const att = await request.get(`${API}/agent/attachments?session=probe`, { headers: AUTH });
  test.skip(att.status() === 404, "engine without the attachment routes (#121)");
});

test("issue 194: long paste -> attachment chip, short paste stays text", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  const box = panel.getByLabel("Message the agent");
  await expect(box).toBeVisible({ timeout: 15_000 });

  await paste(page, "x".repeat(5000));
  const chip = panel.locator("[data-attachment]");
  await expect(chip).toHaveAttribute("data-attachment", "ready", { timeout: 30_000 });
  await expect(chip).toContainText("pasted-text-1.txt");
  const value = await box.inputValue();
  expect(value.length).toBeLessThan(200);
  expect(value).toContain("pasted-text-1.txt");

  await box.fill("");
  // not cancelled: the browser inserts the text as usual
  expect(await paste(page, "short pasted text")).toBe(true);
  await expect(panel.locator("[data-attachment]")).toHaveCount(1);
});
