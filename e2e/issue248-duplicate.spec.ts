import { expect, test } from "@playwright/test";

import type { Workspace } from "../src/api/types";
import { churnWorkspace, openWorkspaceBench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#248 — a duplicated workspace works: the copy carries the
 * steps (including an edit made a moment before the click: the autosave is
 * debounced), the variable and the memory; it opens, runs its first step and
 * survives a reload; the original is not modified by the copy.
 */
test("issue 248: duplicate right after an edit, open the copy, reload", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const base = churnWorkspace();
  const original: Workspace = {
    ...base,
    name: "dup248",
    variables: [{ name: "age_mean", stat: "mean", column: "age" }],
    memory: [{ id: "m1", text: "keep age", kind: "fact" }],
    steps: [
      { id: "s248a", op: "drop_columns", target: "both", params: { columns: ["support_calls"] } },
    ],
  };

  await openWorkspaceBench(page, original, "age");
  await page.getByLabel("Screens").getByRole("button", { name: /Sources/ }).click();
  const sidebar = page.getByLabel("Workspaces");
  await expect(sidebar.locator('.ws-item[data-workspace="dup248"]')).toBeVisible({
    timeout: 30_000,
  });

  // Edit, then click Duplicate before the debounced autosave fires.
  await page.evaluate(async () => {
    const st = window.__DTK_STATE__!().workspace!;
    window.__DTK_DISPATCH__!({
      type: "SET_STEPS",
      steps: [
        ...st.steps,
        { id: "s248b", op: "drop_columns", target: "both", params: { columns: ["sessions"] } },
      ],
    });
    // Let React commit the edit (a user click always follows a commit) but
    // stay well inside the 250 ms autosave debounce.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.ws-item[data-workspace="dup248"] button',
      ),
    ).find((b) => /Duplicate/.test(`${b.textContent} ${b.ariaLabel ?? ""}`));
    button?.click();
  });
  const copyItem = sidebar.locator('.ws-item[data-workspace="dup248-copy"]');
  await expect(copyItem).toBeVisible({ timeout: 15_000 });

  const copy = (await (await request.get("/api/workspaces/dup248-copy")).json()) as Workspace;
  expect(copy.steps.map((s) => s.id)).toEqual(["s248a", "s248b"]);
  expect(copy.variables).toEqual(original.variables);
  expect(copy.memory?.map((m) => m.text)).toEqual(["keep age"]);

  // The copy is open; its first step runs (grid loads with the step applied).
  await page.getByLabel("Screens").getByRole("button", { name: /Workbench/ }).click();
  await waitForGridReady(page);
  await expect(page.getByLabel("Workbench")).toContainText("Drop columns");

  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await expect(sidebar.locator('.ws-item[data-workspace="dup248-copy"]')).toBeVisible({
    timeout: 30_000,
  });

  const orig = (await (await request.get("/api/workspaces/dup248")).json()) as Workspace;
  expect(orig.name).toBe("dup248");
  expect(orig.steps.map((s) => s.id)).toEqual(["s248a", "s248b"]);
  expect(orig.variables).toEqual(original.variables);
});
