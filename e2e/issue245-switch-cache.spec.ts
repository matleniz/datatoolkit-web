import { expect, test, type Page } from "@playwright/test";
import { openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#245: switching Train / Test (and back) shows a frame
 * already loaded without asking the engine again; a changed step or a source
 * edit shows fresh data.
 */
const FRAME_CALLS = /\/api\/workspace\/(rows|profiles)$/;

function frameCalls(page: Page): { role: string; version: number | null }[] {
  return calls.get(page) ?? [];
}
const calls = new WeakMap<Page, { role: string; version: number | null }[]>();

function track(page: Page): void {
  const list: { role: string; version: number | null }[] = [];
  calls.set(page, list);
  page.on("request", (r) => {
    if (r.method() !== "POST" || !FRAME_CALLS.test(r.url())) return;
    const b = r.postDataJSON() as { role: string; version: number | null };
    list.push({ role: b.role, version: b.version });
  });
}

const shown = (page: Page, name: "Train" | "Test") =>
  page.getByRole("group", { name: "Dataset shown" }).getByRole("button", { name });

async function switchTo(page: Page, name: "Train" | "Test"): Promise<void> {
  await shown(page, name).click();
  await expect(shown(page, name)).toHaveAttribute("aria-pressed", "true");
  await waitForGridReady(page);
}

test("issue 245: train -> test -> train asks the engine only for what is new", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  track(page);

  await switchTo(page, "Test"); // first visit: loaded
  const afterTest = frameCalls(page).filter((c) => c.role === "test").length;
  expect(afterTest).toBeGreaterThan(0);

  const before = frameCalls(page).length;
  await switchTo(page, "Train"); // back: from memory
  await expect(page.locator(".grid-row").first()).toBeVisible();
  expect(frameCalls(page).length).toBe(before);

  await switchTo(page, "Test");
  expect(frameCalls(page).length).toBe(before);
});

test("issue 245: an edited step is not served from memory", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  await switchTo(page, "Test");
  await switchTo(page, "Train");
  track(page);

  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({
      type: "ADD_STEP",
      step: { op: "drop_columns", target: "both", params: { columns: ["age"] } },
    }),
  );
  await waitForGridReady(page);
  await expect(page.locator(".grid-th", { hasText: /^age/ })).toHaveCount(0);

  await switchTo(page, "Test");
  await expect(page.locator(".grid-th", { hasText: /^age/ })).toHaveCount(0);
  await switchTo(page, "Train");
  await expect(page.locator(".grid-th", { hasText: /^age/ })).toHaveCount(0);
  // Both roles were fetched at the new version, not at the old one.
  expect(frameCalls(page).some((c) => c.role === "test" && c.version === 1)).toBe(true);
});
