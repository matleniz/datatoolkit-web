import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";

import type { Workspace } from "../src/api/types";
import { expectNoA11yViolations } from "./a11y";
import { openWorkbench } from "./helpers";

/**
 * datatoolkit-issues#221 — a render exception shows a fallback (message,
 * Reload, Export workspace JSON) instead of a blank page, and an edit made
 * inside the autosave debounce is sent with a keepalive PUT when the page closes.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api`;

async function stored(request: APIRequestContext): Promise<Workspace> {
  return (await (await request.get(`${API}/workspaces/churn`)).json()) as Workspace;
}

test("issue 221: render error shows the fallback, export downloads, Reload recovers", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") { errors.push(m.text()); }
  });
  await openWorkbench(page, true);

  // Malformed workspace (a null step): the bench throws while rendering.
  await page.evaluate(() => {
    const s = window.__DTK_STATE__!().workspace!;
    window.__DTK_DISPATCH__!({
      type: "SET_WORKSPACE",
      workspace: { ...s, steps: [null] } as never,
    });
  });

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("The screen could not be displayed", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  expect(errors.some((e) => e.includes("[ui] render error"))).toBe(true);
  await expectNoA11yViolations(page, "render error fallback (#221)");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workspace JSON" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("churn.workspace.json");
  const parsed = JSON.parse(readFileSync((await file.path())!, "utf8")) as Workspace;
  expect(parsed.name).toBe("churn");
  expect(parsed.datasets.train.x.path).toBeTruthy();

  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Export workspace JSON" })).toHaveCount(0);
  await expect(page.getByLabel("Sources screen").or(page.getByLabel("Data grid")).first()).toBeVisible({
    timeout: 60_000,
  });
});

test("issue 221: an edit followed by closing the page inside the debounce is on disk", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  expect((await stored(request)).notes?.workspace ?? null).toBeNull();

  // Freeze the debounce timer: the edit stays "inside the debounce window"
  // however long closing takes, so only the pagehide flush can persist it.
  await page.evaluate(() => {
    window.setTimeout = (() => 0) as unknown as typeof window.setTimeout;
  });
  // A note triggers no analysis, which would save the workspace by itself.
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({ type: "SET_WORKSPACE_NOTE", text: "typed just before closing" }),
  );
  await page.close({ runBeforeUnload: true });

  await expect
    .poll(async () => (await stored(request)).notes?.workspace, { timeout: 15_000 })
    .toBe("typed just before closing");
});
