import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { Step, Workspace } from "../src/api/types";
import { churnWorkspace, openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#152 — notes on steps, columns and the workspace: icon +
 * popover, one undo entry each, kept across a rename (origin key), a reload
 * and an export / import of the workspace JSON; the agent writes them with
 * `set_note` through the same undo path.
 */
const PORT = process.env.DTK_E2E_API_PORT ?? "8766";
const API = `http://127.0.0.1:${PORT}/api`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

const impute: Step = { op: "impute", target: "both", params: { columns: ["age"], strategy: "median" } };
const renameAge: Step = { op: "rename", target: "both", params: { mapping: { age: "age_years" } } };

const workspace = (page: Page) =>
  page.evaluate(() => window.__DTK_STATE__?.()?.workspace as Workspace);

async function stored(request: APIRequestContext, name = "churn"): Promise<Workspace> {
  return (await (await request.get(`${API}/workspaces/${name}`)).json()) as Workspace;
}

async function saved(page: Page) {
  await page.waitForFunction(async () => {
    const p = window.__DTK_WORKSPACE_SAVED__;
    if (!p) return false;
    await p;
    return true;
  });
}

async function writeNote(page: Page, button: string | RegExp, text: string) {
  await page.getByRole("button", { name: button }).click();
  const pop = page.getByRole("dialog", { name: button });
  await pop.getByLabel("Note text").fill(text);
  await pop.getByRole("button", { name: "Save" }).click();
  await expect(pop).toHaveCount(0);
}

async function openWithSteps(page: Page, steps: Step[]) {
  await openWorkbench(page, true);
  await page.evaluate((ws) => window.__DTK_DISPATCH__!({ type: "SET_WORKSPACE", workspace: ws }), {
    ...churnWorkspace(),
    steps,
  });
  await waitForGridReady(page);
}

test("issue 152: step, column and workspace notes; undo, rename, reload, export / import", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWithSteps(page, [impute]);

  // Step note: the card's note button.
  await writeNote(page, /^Note on step 1 /, "median: age is skewed");
  expect((await workspace(page)).steps[0]).toMatchObject({ id: "s1", note: "median: age is skewed" });
  await expect(page.getByRole("button", { name: /^Note on step 1 / })).toHaveAttribute("data-has-note", "1");

  // Workspace note: the sources card.
  await writeNote(page, "Note on the workspace", "churn dogfood");

  // Column note: column menu -> Add note…, then a marker on the header.
  await page.getByRole("button", { name: "age, number" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add note…" }).click();
  const pop = page.getByRole("dialog", { name: "Note on column age" });
  await pop.getByLabel("Note text").fill("years since birth");
  await pop.getByRole("button", { name: "Save" }).click();
  const header = page.getByRole("button", { name: "age, number" });
  await expect(header.getByRole("img", { name: "Column note" })).toHaveAttribute("title", "years since birth");
  expect((await workspace(page)).notes).toEqual({
    workspace: "churn dogfood",
    columns: { age: "years since birth" },
  });

  // Each note is one undo entry; notes never change the frame shown.
  const grid = page.getByLabel("Data grid");
  const identity = await grid.getAttribute("data-identity-current");
  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  await expect.poll(async () => (await workspace(page)).notes?.columns ?? {}).toEqual({});
  await expect(header.getByRole("img", { name: "Column note" })).toHaveCount(0);
  await page.getByRole("button", { name: "Redo pipeline change" }).click();
  await expect.poll(async () => (await workspace(page)).notes?.columns).toEqual({ age: "years since birth" });
  await expect(grid).toHaveAttribute("data-identity-current", identity!);

  // A rename keeps the note: stored under the origin name, shown on the new one.
  await page.evaluate((step) => window.__DTK_DISPATCH__!({ type: "ADD_STEP", step }), renameAge);
  await waitForGridReady(page);
  const renamed = page.getByRole("button", { name: "age_years, number" });
  await expect(renamed.getByRole("img", { name: "Column note" })).toHaveAttribute("title", "years since birth");

  // Stored, and back after a reload.
  await saved(page);
  const ws = await stored(request);
  expect(ws.steps[0]?.note).toBe("median: age is skewed");
  expect(ws.notes).toEqual({ workspace: "churn dogfood", columns: { age: "years since birth" } });
  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await waitForGridReady(page);
  await expect(page.getByRole("button", { name: /^Note on step 1 / })).toHaveAttribute("title", "median: age is skewed");
  await expect(page.getByRole("button", { name: "Note on the workspace" })).toHaveAttribute("title", "churn dogfood");
  await expect(renamed.getByRole("img", { name: "Column note" })).toHaveAttribute("title", "years since birth");

  // Export the workspace JSON and import it under another name: notes travel with it.
  const copy = { ...ws, name: "churn_notes_copy" };
  const put = await request.put(`${API}/workspaces/churn_notes_copy`, { data: copy });
  expect(put.ok()).toBe(true);
  const imported = await stored(request, "churn_notes_copy");
  expect(imported.notes).toEqual(ws.notes);
  expect(imported.steps.map((s) => [s.id, s.note])).toEqual(ws.steps.map((s) => [s.id, s.note]));
  await request.delete(`${API}/workspaces/churn_notes_copy`);

  // Delete from the popover.
  await page.getByRole("button", { name: /^Note on step 1 / }).click();
  await page.getByRole("dialog", { name: /^Note on step 1 / }).getByRole("button", { name: "Delete" }).click();
  await expect.poll(async () => "note" in (await workspace(page)).steps[0]!).toBe(false);
});

test("issue 152: set_note from the agent bridge writes notes, Undo reverts, bad targets refused", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWithSteps(page, [impute, renameAge]);
  const sid = await page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);
  const send = async (cmd: Record<string, unknown>) => {
    const res = await request.post(`${API}/ui/commands`, {
      headers: AUTH,
      data: { type: "set_note", workspace: "churn", ...cmd, session: sid, timeout: 30 },
    });
    expect(res.ok()).toBe(true);
    return (await res.json()) as Record<string, unknown>;
  };

  expect(await send({ kind: "step", step_id: "s2", text: "names for the report" })).toMatchObject({ ok: true });
  expect(await send({ kind: "column", column: "age_years", text: "renamed from age" })).toMatchObject({ ok: true });
  const ws = await workspace(page);
  expect(ws.steps[1]?.note).toBe("names for the report");
  expect(ws.notes?.columns).toEqual({ age: "renamed from age" });

  // The toast's Undo reverts the last note.
  const toast = page.getByRole("status").filter({ hasText: "Agent: note on column age_years" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await workspace(page)).notes?.columns ?? {}).toEqual({});

  expect(await send({ kind: "step", step_id: "s9", text: "x" })).toMatchObject({
    ok: false, error: "bad_command: no step s9",
  });
  expect(await send({ kind: "column", column: "age", text: "x" })).toMatchObject({
    ok: false, error: "bad_command: no column age",
  });
});
