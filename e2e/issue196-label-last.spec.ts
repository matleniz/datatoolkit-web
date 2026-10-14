import { expect, test, type Page } from "@playwright/test";

import { churnWorkspace, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#196 — "Keep target column last" on the Sources target
 * card: a one-hot step adds columns after the label; with the toggle on the
 * label is the last grid column, off it is left where the step put it.
 */
const PORT = process.env.DTK_E2E_API_PORT ?? "8766";
const API = `http://127.0.0.1:${PORT}/api`;

const headers = (page: Page) => page.locator(".grid-th .th-name").allTextContents();

test("issue 196: the toggle keeps the target column last after a step adding columns", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await request.delete(`${API}/workspaces/churn`);
  const ws = churnWorkspace();
  ws.steps = [
    { id: "s1", op: "onehot", target: "both", params: { columns: ["city"] } },
  ] as typeof ws.steps;
  expect((await request.put(`${API}/workspaces/churn`, { data: ws })).ok()).toBe(true);

  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
  const toggle = page.getByLabel("Target settings").getByLabel("Keep target column last");
  await expect(toggle).toBeEnabled({ timeout: 30_000 });
  await expect(toggle).not.toBeChecked();

  await page.getByRole("button", { name: "Open workbench" }).click();
  await waitForGridReady(page);
  const off = await headers(page);
  expect(off).toContain("churn");
  expect(off.at(-1)).not.toBe("churn");

  await page.getByLabel("Screens").getByRole("button", { name: /Sources/ }).click();
  await toggle.check();
  await page.getByRole("button", { name: "Open workbench" }).click();
  await waitForGridReady(page);
  await expect.poll(async () => (await headers(page)).at(-1)).toBe("churn");
  expect(new Set(await headers(page))).toEqual(new Set(off));

  // One undoable change: undo puts the order back.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => await headers(page)).toEqual(off);
});
