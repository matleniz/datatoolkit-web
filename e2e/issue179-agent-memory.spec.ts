import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { Step, Workspace } from "../src/api/types";
import { churnWorkspace, openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#179 — agent memory per workspace: `remember` / `forget`
 * from the agent bridge (toast + Undo, one pipeline undo entry), the "Agent
 * memory" view of the agent panel (edit / delete / clear), stored in the
 * workspace JSON (reload, PUT round-trip); the stub pack drives the real
 * MCP tools (remember / get_memory / forget) through Studio.
 */
const PORT = process.env.DTK_E2E_API_PORT ?? "8766";
const API = `http://127.0.0.1:${PORT}/api`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

const ENGINE = process.env.DTK_ENGINE_DIR ?? "";

/** The stub pack drives the real dtk MCP tools against this dtk-api (`mcp_stub_driver.py`, #100). */
function runTools(script: { tool: string; args: Record<string, unknown> }[]) {
  const stdout = execFileSync(join(ENGINE, ".venv/bin/python"), [join(process.cwd(), "e2e", "mcp_stub_driver.py")], {
    input: JSON.stringify(script),
    env: { ...process.env, DTK_HOME: process.env.DTK_E2E_HOME },
  });
  return (JSON.parse(stdout.toString()) as { results: { tool: string; is_error: boolean; result: unknown }[] })
    .results;
}

const impute: Step = { op: "impute", target: "both", params: { columns: ["age"], strategy: "median" } };

const memory = (page: Page) =>
  page.evaluate(() => (window.__DTK_STATE__?.()?.workspace as Workspace | undefined)?.memory ?? []);

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

async function openWithSteps(page: Page, steps: Step[], extra: Partial<Workspace> = {}) {
  await openWorkbench(page, true);
  await page.evaluate((ws) => window.__DTK_DISPATCH__!({ type: "SET_WORKSPACE", workspace: ws }), {
    ...churnWorkspace(),
    steps,
    ...extra,
  });
  await waitForGridReady(page);
}

async function openMemory(page: Page) {
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  await panel.getByRole("button", { name: "Memory" }).click();
  return panel.getByRole("region", { name: "Agent memory" });
}

test.beforeEach(async ({ request }) => {
  const res = await request.get(`${API}/ui/commands/schema`, { headers: AUTH });
  const table = (await res.json()) as Record<string, unknown>;
  test.skip(!("remember" in table), "engine without the remember command (#179)");
});

test("issue 179: remember / forget from the bridge, Undo, the Agent memory view, reload", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWithSteps(page, [impute]);
  const sid = await page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);
  const send = async (type: string, cmd: Record<string, unknown>) => {
    const res = await request.post(`${API}/ui/commands`, {
      headers: AUTH,
      data: { type, workspace: "churn", ...cmd, session: sid, timeout: 30 },
    });
    expect(res.ok()).toBe(true);
    return (await res.json()) as Record<string, unknown>;
  };
  const grid = page.getByLabel("Data grid");
  const identity = await grid.getAttribute("data-identity-current");

  expect(await send("remember", { text: "ledd is in mg/day, 0 means untreated" })).toMatchObject({
    ok: true, memory_id: "m1",
  });
  expect(await send("remember", { text: "median for skewed columns", kind: "decision" })).toMatchObject({
    ok: true, memory_id: "m2",
  });
  expect(await memory(page)).toMatchObject([
    { id: "m1", text: "ledd is in mg/day, 0 means untreated", kind: "fact" },
    { id: "m2", text: "median for skewed columns", kind: "decision" },
  ]);

  // The toast's Undo reverts the last write; memory never moves the frame shown.
  const toast = page.getByRole("status").filter({ hasText: "Agent: remembered “median for skewed columns”" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await memory(page)).map((e) => e.id)).toEqual(["m1"]);
  await expect(grid).toHaveAttribute("data-identity-current", identity!);

  expect(await send("remember", { memory_id: "m9", text: "x" })).toMatchObject({
    ok: false, error: "bad_command: unknown memory id m9",
  });
  expect(await send("forget", { memory_id: "m9" })).toMatchObject({
    ok: false, error: "bad_command: unknown memory id m9",
  });

  // Stored with the workspace, back after a reload.
  await saved(page);
  expect((await stored(request)).memory).toMatchObject([{ id: "m1", kind: "fact" }]);
  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await waitForGridReady(page);

  // The panel view: list, edit, delete, clear.
  const view = await openMemory(page);
  const m1 = view.locator('[data-memory-id="m1"]');
  await expect(m1).toContainText("ledd is in mg/day, 0 means untreated");
  await expect(view.locator("[data-memory-usage]")).toHaveText("1 entry · 36 / 8000 chars");
  await view.getByRole("button", { name: "Edit memory m1" }).click();
  await view.getByLabel("Memory text").fill("ledd in mg/day; 0 = untreated");
  await view.getByLabel("Memory kind").selectOption("preference");
  await view.getByRole("button", { name: "Save" }).click();
  await expect(m1).toContainText("ledd in mg/day; 0 = untreated");
  expect(await memory(page)).toMatchObject([{ id: "m1", text: "ledd in mg/day; 0 = untreated", kind: "preference" }]);
  await saved(page);
  expect((await stored(request)).memory).toMatchObject([{ id: "m1", text: "ledd in mg/day; 0 = untreated" }]);

  // The agent forgets; Undo brings it back; the user deletes it from the view.
  expect(await send("forget", { memory_id: "m1" })).toMatchObject({ ok: true });
  await expect(view.getByText("No memory yet.")).toBeVisible();
  await page.getByRole("status").filter({ hasText: "Agent: forgot" }).getByRole("button", { name: "Undo" }).click();
  await expect(m1).toBeVisible();
  await view.getByRole("button", { name: "Delete memory m1" }).click();
  await expect(view.getByText("No memory yet.")).toBeVisible();
  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  await expect(m1).toBeVisible();

  // Clear asks first.
  page.once("dialog", (d) => void d.accept());
  await view.getByRole("button", { name: "Clear memory" }).click();
  await expect(view.getByText("No memory yet.")).toBeVisible();
  await saved(page);
  expect((await stored(request)).memory ?? []).toEqual([]);
});

test("issue 179: the agent (stub pack, real MCP tools) remembers through Studio and reads it back", async ({
  page, request,
}) => {
  test.skip(!ENGINE, "set DTK_ENGINE_DIR to an engine checkout with a synced .venv (extra agent)");
  test.setTimeout(180_000);
  await openWithSteps(page, [impute], { memory: [] });
  await saved(page);
  const sid = await page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);
  await expect
    .poll(async () => {
      const r = await request.get(`${API}/ui/context`, { headers: AUTH, params: { session: sid } });
      return r.ok() ? ((await r.json()) as { workspace?: string }).workspace : null;
    }, { timeout: 15_000 })
    .toBe("churn");

  const s = { session: sid };
  const [first, second, read] = runTools([
    { tool: "remember", args: { ...s, text: "ledd is in mg/day, 0 means untreated" } },
    { tool: "remember", args: { ...s, text: "report medians", kind: "preference" } },
    { tool: "get_memory", args: { ...s } },
  ]);
  expect(first!.is_error).toBe(false);
  expect(JSON.stringify(first!.result)).toContain("m1");
  expect(second!.is_error).toBe(false);
  expect(JSON.stringify(read!.result)).toContain("ledd is in mg/day, 0 means untreated");
  expect(JSON.stringify(read!.result)).toContain("report medians");
  await expect(page.getByRole("status").filter({ hasText: "Agent: remembered “report medians”" })).toBeVisible();
  await saved(page);
  expect((await stored(request)).memory).toMatchObject([
    { id: "m1", kind: "fact" },
    { id: "m2", kind: "preference" },
  ]);

  // forget through MCP; the view follows.
  const [forgot] = runTools([{ tool: "forget", args: { ...s, memory_id: "m1" } }]);
  expect(forgot!.is_error).toBe(false);
  const view = await openMemory(page);
  await expect(view.locator('[data-memory-id="m1"]')).toHaveCount(0);
  await expect(view.locator('[data-memory-id="m2"]')).toContainText("report medians");
});

test("issue 180: a forgotten memory id never comes back", async ({ page, request }) => {
  test.setTimeout(180_000);
  await openWithSteps(page, [impute], { memory: [] });
  const sid = await page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);
  const send = async (type: string, cmd: Record<string, unknown>) => {
    const res = await request.post(`${API}/ui/commands`, {
      headers: AUTH,
      data: { type, workspace: "churn", ...cmd, session: sid, timeout: 30 },
    });
    expect(res.ok()).toBe(true);
    return (await res.json()) as Record<string, unknown>;
  };
  expect(await send("remember", { text: "first" })).toMatchObject({ ok: true, memory_id: "m1" });
  expect(await send("forget", { memory_id: "m1" })).toMatchObject({ ok: true });
  expect(await send("remember", { text: "second" })).toMatchObject({ ok: true, memory_id: "m2" });
  await saved(page);
  const ws = await stored(request);
  expect(ws.memory).toMatchObject([{ id: "m2", text: "second" }]);
  expect(ws.id_counters).toMatchObject({ m: 2 });
});
