import { expect, test, type Page } from "@playwright/test";
import { openWorkbench, sourceFileInput } from "./helpers";

/**
 * datatoolkit-issues#299 — a file over the engine upload cap (the e2e engine
 * runs with DTK_MAX_UPLOAD_MB=4, playwright.config.ts) gets the real 413
 * UploadTooLargeError. Studio shows its message where the file was added.
 */
const CAP_MB = Number(process.env.DTK_MAX_UPLOAD_MB ?? "4");
const big = (name: string) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.alloc(Math.ceil((CAP_MB + 1) * 1024 * 1024), "a"),
});
const ENGINE = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}`;

/**
 * The engine answers 413 on Content-Length without reading the body, so the
 * Vite dev proxy often hits ECONNRESET and answers an empty 500 instead
 * (datatoolkit-issues#302). Until the engine drains the body, the uploads of
 * these specs go to the engine directly; the 413 itself is the real one.
 */
async function uploadsBypassProxy(page: Page): Promise<void> {
  await page.route("**/api/uploads/**", (route) => {
    const { pathname, search } = new URL(route.request().url());
    return route.continue({ url: `${ENGINE}${pathname}${search}` });
  });
}

const capText = new RegExp(`over the ${CAP_MB} MiB limit; raise it with the DTK_MAX_UPLOAD_MB variable`);

async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "+ New workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(`Sources of “${name}”`)).toBeVisible({ timeout: 15_000 });
}

test("issue 299: a source file over the cap shows the engine message by Add a file", async ({ page }) => {
  await uploadsBypassProxy(page);
  await createWorkspace(page, "too-large");
  const res = page.waitForResponse((r) => r.url().includes("/api/uploads/") && r.request().method() === "PUT");
  await sourceFileInput(page).setInputFiles(big("huge.csv"));
  const answer = await res;
  expect(answer.status()).toBe(413);
  expect(await answer.json()).toMatchObject({ type: "UploadTooLargeError" });

  const filesList = page.getByRole("region", { name: "Files list" });
  const alert = filesList.locator(".files-upload-error");
  await expect(alert).toHaveText(capText);
  await expect(alert).toContainText("Cannot add “huge.csv”");
  await expect(filesList.locator(".files-table-row", { hasText: "huge.csv" })).toHaveCount(0);
  // Not the generic engine-error banner of the Result card.
  await expect(page.getByRole("region", { name: "Result schema" }).getByText(capText)).toHaveCount(0);
  await expect(page.getByLabel("Sources screen")).toBeVisible();
});

test("issue 299: a document over the cap shows the engine message in Documents", async ({ page }) => {
  await uploadsBypassProxy(page);
  await page.goto("/");
  await expect(page.getByText("Sources of “churn”")).toBeVisible({ timeout: 60_000 });
  const section = page.getByRole("region", { name: "Documents" });
  const before = await section.getByRole("listitem").count();
  await section.locator('input[type="file"]').setInputFiles([big("huge.md")]);
  const alert = section.getByRole("alert");
  await expect(alert).toHaveText(capText);
  await expect(alert).toContainText("Cannot add “huge.md”");
  await expect(section.getByRole("listitem")).toHaveCount(before);
});

test("issue 299: an agent attachment over the cap is marked too large", async ({ page, request }) => {
  test.setTimeout(120_000);
  const api = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/ui`;
  const probe = await request.get(`${api}/agent`, {
    headers: { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` },
  });
  test.skip(probe.status() === 404, "engine without the agent chat routes (#67)");
  await uploadsBypassProxy(page);
  await openWorkbench(page, true);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  await expect(panel.getByLabel("Message the agent")).toBeVisible({ timeout: 15_000 });

  await panel.locator("[data-attach-input]").setInputFiles(big("huge.csv"));
  const chip = panel.locator("[data-attachment]");
  await expect(chip).toHaveAttribute("data-attachment", "failed", { timeout: 30_000 });
  await expect(chip).toContainText("too large");
  await expect(chip).toHaveAttribute("title", capText);
});
