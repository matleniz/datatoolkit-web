import { expect, test } from "@playwright/test";

import { churnWorkspace, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#199 — Sources used to name the label from the frame
 * *after* the steps: with a one-hot step the first column that is new compared
 * to train X (a dummy) was shown as "Label column" and became the target.
 */
const PORT = process.env.DTK_E2E_API_PORT ?? "8766";
const API = `http://127.0.0.1:${PORT}/api`;

test("issue 199: Sources keeps the y file's column as the label when steps add columns", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await request.delete(`${API}/workspaces/churn`);
  const ws = churnWorkspace();
  ws.steps = [
    { id: "s1", op: "onehot", target: "both", params: { columns: ["city"] } },
  ] as typeof ws.steps;
  const put = await request.put(`${API}/workspaces/churn`, { data: ws });
  expect(put.ok()).toBe(true);

  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
  const target = page.getByLabel("Target settings");
  await expect(target.getByText("Label column: churn")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Open workbench" }).click();
  await waitForGridReady(page);
  const targetColumn = await page.evaluate(
    () => window.__DTK_STATE__?.()?.targetColumn ?? null,
  );
  expect(targetColumn).toBe("churn");
});
