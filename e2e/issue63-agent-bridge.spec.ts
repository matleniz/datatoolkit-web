import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#63 — Studio side of the agent bridge. No agent here:
 * commands go straight to the engine's `POST /api/ui/commands` (which relays
 * them to this tab over SSE and returns Studio's ack), with the per-run token
 * playwright.config.ts hands to the engine and the page.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/ui`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

interface Ack {
  id: string;
  ok: boolean;
  error?: string;
  identity?: string;
}

const session = (page: Page) =>
  page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);

async function context(request: APIRequestContext, sid: string): Promise<Ctx | null> {
  const res = await request.get(`${API}/context`, { headers: AUTH, params: { session: sid } });
  return res.ok() ? ((await res.json()) as Ctx) : null;
}

type Ctx = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** This tab's published context (debounced PUT), once `ready` accepts it. */
async function published(
  request: APIRequestContext,
  page: Page,
  ready: (ctx: Ctx) => boolean = (ctx) => ctx.workspace === "churn",
): Promise<Ctx> {
  const sid = await session(page);
  let last: Ctx | null = null;
  await expect
    .poll(async () => {
      last = await context(request, sid);
      return last !== null && ready(last);
    }, { timeout: 15_000 })
    .toBe(true);
  return last!;
}

async function send(request: APIRequestContext, page: Page, cmd: Record<string, unknown>) {
  const sid = await session(page);
  const res = await request.post(`${API}/commands`, {
    headers: AUTH,
    data: { ...cmd, session: sid, timeout: 30 },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as Ack;
}

const stepOps = (page: Page) =>
  page.evaluate(() => window.__DTK_STATE__?.()?.workspace?.steps.map((s) => s.op) ?? []);

const scale = { op: "scale", target: "both", params: { columns: ["age"] } };

/** Grid and the Distribution window both show (and wait for) `identity`. */
async function expectShowing(page: Page, identity: string) {
  const grid = page.getByLabel("Data grid");
  await expect(grid).toHaveAttribute("data-identity-current", identity, { timeout: 30_000 });
  await expect(grid).toHaveAttribute("data-identity", identity, { timeout: 60_000 });
  const dist = page.locator('[data-tool="dist"]');
  await expect(dist.locator("[data-identity-current]").first()).toHaveAttribute(
    "data-identity-current", identity,
  );
  await expect(dist.locator("[data-identity]").first()).toHaveAttribute(
    "data-identity", identity, { timeout: 60_000 },
  );
}

test("issue 63: propose_steps applies at once, refreshes the views, Undo restores", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);

  // The context is published, with the identity of the frame on screen.
  const ctx0 = await published(request, page);
  expect(ctx0).toMatchObject({ screen: "bench", workspace: "churn", role: "train", version: 0, latest: 0 });

  // An open Distribution window must refresh with the grid.
  const opened = await send(request, page, {
    type: "open_window", tool: "dist", params: { column: "age" },
  });
  expect(opened).toMatchObject({ ok: true, identity: ctx0.identity });
  await expectShowing(page, ctx0.identity);
  const ctx1 = await published(request, page, (c) => c.windows.length === 1);
  // The window adds its own defaults to the params (bins, norm, ...).
  expect(ctx1.windows).toHaveLength(1);
  expect(ctx1.windows[0]).toMatchObject({ tool: "dist", params: { column: "age" } });
  expect(ctx1.selection.columns).toEqual(["age"]);

  // Non-destructive: applied at once, acked with the new identity, Undo toast.
  const ack = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: ctx0.identity,
    ops: [{ add: { step: scale } }],
  });
  expect(ack.ok).toBe(true);
  expect(ack.identity).toBeTruthy();
  expect(ack.identity).not.toBe(ctx0.identity);
  expect(await stepOps(page)).toEqual(["scale"]);
  const toast = page.getByRole("status").filter({ hasText: "Agent: add scale (age)" });
  await expect(toast).toBeVisible();
  await expectShowing(page, ack.identity!);
  const ctx2 = await published(request, page, (c) => c.identity === ack.identity);
  expect(ctx2).toMatchObject({ version: 1, latest: 1 });

  // The engine store holds the step already (acked after the save gate).
  const stored = await request.get(`http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/workspaces/churn`);
  expect(((await stored.json()) as { steps: unknown[] }).steps).toHaveLength(1);

  // Undo = one click, back to the previous identity.
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast).toBeHidden();
  expect(await stepOps(page)).toEqual([]);
  await expectShowing(page, ctx0.identity);
  await published(request, page, (c) => c.identity === ctx0.identity);
});

test("issue 63: a batch is one undo entry; a stale base_identity is refused", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  const ctx0 = await published(request, page);

  const ack = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: ctx0.identity,
    ops: [
      { add: { step: scale } },
      { add: { step: { op: "impute", target: "both", params: { columns: ["age"], strategy: "median" } } } },
    ],
  });
  expect(ack.ok).toBe(true);
  expect(await stepOps(page)).toEqual(["scale", "impute"]);
  await waitForGridReady(page);

  // One Undo undoes both ops.
  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  expect(await stepOps(page)).toEqual([]);

  // The frame moved on (a step applied by the user): the old identity is stale.
  await page.evaluate(() => {
    window.__DTK_DISPATCH__!({
      type: "ADD_STEP",
      step: { op: "scale", target: "both", params: { columns: ["sessions"] } },
    });
  });
  const stale = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: ctx0.identity,
    ops: [{ add: { step: scale } }],
  });
  expect(stale).toMatchObject({ ok: false, error: "stale" });
  expect(await stepOps(page)).toEqual(["scale"]);

  // Invalid payloads are bad_command.
  const bad = await send(request, page, { type: "propose_steps", workspace: "churn" });
  expect(bad.ok).toBe(false);
  expect(bad.error).toMatch(/^bad_command: /);
  const unknown = await send(request, page, { type: "explode" });
  expect(unknown.error).toMatch(/^bad_command: /);
});

test("issue 63: a destructive proposal is reviewed first (Apply / Dismiss)", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  const ctx0 = await published(request, page);
  const drop = (col: string) => ({
    type: "propose_steps", workspace: "churn", base_identity: ctx0.identity,
    ops: [{ add: { step: { op: "drop_columns", target: "both", params: { columns: [col] } } } }],
  });
  const review = page.getByLabel("Agent proposal");

  // Dismiss → rejected, nothing applied.
  const dismissed = send(request, page, drop("support_calls"));
  await expect(review).toBeVisible();
  await expect(review).toContainText("drop_columns (support_calls)");
  expect(await stepOps(page)).toEqual([]);
  await review.getByRole("button", { name: "Dismiss" }).click();
  expect(await dismissed).toMatchObject({ ok: false, error: "rejected" });
  await expect(review).toBeHidden();
  expect(await stepOps(page)).toEqual([]);

  // Apply → applied, ack with the new identity.
  const applied = send(request, page, drop("support_calls"));
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Apply" }).click();
  const ack = await applied;
  expect(ack.ok).toBe(true);
  expect(ack.identity).not.toBe(ctx0.identity);
  expect(await stepOps(page)).toEqual(["drop_columns"]);
  await waitForGridReady(page);
  await expect(page.getByRole("button", { name: "support_calls, number" })).toHaveCount(0);

  // Removing a step is destructive too.
  const removal = send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: ack.identity,
    ops: [{ remove: { index: 0 } }],
  });
  await expect(review).toContainText("remove step 1 (drop_columns)");
  await review.getByRole("button", { name: "Apply" }).click();
  expect((await removal).ok).toBe(true);
  expect(await stepOps(page)).toEqual([]);
});

test("issue 63: open_window, select_columns and set_view drive the view", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  const ctx0 = await published(request, page);

  const sel = await send(request, page, { type: "select_columns", columns: ["age", "sessions"] });
  expect(sel).toMatchObject({ ok: true, identity: ctx0.identity });
  expect((await published(request, page, (c) => c.selection.columns.length === 2)).selection.columns).toEqual(["age", "sessions"]);

  const win = await send(request, page, { type: "open_window", tool: "corr" });
  expect(win.ok).toBe(true);
  await expect(page.locator('[data-tool="corr"]')).toBeVisible();

  // Give the pipeline a step so a version 0 view differs from the latest.
  const step = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: ctx0.identity,
    ops: [{ add: { step: scale } }],
  });
  expect(step.ok).toBe(true);
  const view = await send(request, page, { type: "set_view", role: "test", version: 0 });
  expect(view.ok).toBe(true);
  expect(view.identity).toContain("churn|test|v0|");
  const ctx = await published(request, page, (c) => c.identity === view.identity);
  expect(ctx).toMatchObject({ role: "test", version: 0, latest: 1 });
  await expect(page.getByRole("group", { name: "Dataset shown" }).getByRole("button", { name: "Test" }))
    .toHaveAttribute("aria-pressed", "true");

  const bad = await send(request, page, { type: "open_window", tool: "nope" });
  expect(bad).toMatchObject({ ok: false });
  expect(bad.error).toMatch(/^bad_command: /);
});

/** #88: what the agent touched is outlined for ~2 s, then the attribute goes away. */
test("issue 88: touched column / window / step carry data-agent-touched, toast Undo reverts", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  const ctx0 = await published(request, page);
  const touched = page.locator("[data-agent-touched]");
  const header = (col: string) => page.getByRole("button", { name: new RegExp(`^${col}, `) });
  const toast = (text: string) => page.getByRole("status").filter({ hasText: text });

  // select_columns: the column headers are touched; Undo restores the selection.
  const sel = await send(request, page, { type: "select_columns", columns: ["age"] });
  expect(sel.ok).toBe(true);
  await expect(header("age")).toHaveAttribute("data-agent-touched", "1");
  await expect(header("sessions")).not.toHaveAttribute("data-agent-touched", /.*/);
  await expect(toast("Agent: selected age")).toBeVisible();
  await expect(touched).toHaveCount(0, { timeout: 6_000 }); // transient

  // open_window: the dock window (and its column) are touched; Undo closes it.
  const win = await send(request, page, {
    type: "open_window", tool: "dist", params: { column: "sessions" },
  });
  expect(win.ok).toBe(true);
  await expect(page.locator('[data-tool="dist"]')).toHaveAttribute("data-agent-touched", "1");
  await expect(header("sessions")).toHaveAttribute("data-agent-touched", "1");
  const opened = toast("Agent: opened Distribution (sessions)");
  await expect(opened).toBeVisible();
  await opened.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator('[data-tool="dist"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__DTK_STATE__?.()?.selection.columns)).toEqual(["age"]);

  // propose_steps: the new step card is touched; Undo = UNDO_STEPS.
  const ack = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: ctx0.identity,
    ops: [{ add: { step: scale } }],
  });
  expect(ack.ok).toBe(true);
  const card = page.getByLabel("Pipeline").locator('[data-agent-touched="1"]').filter({ hasText: "v1" });
  await expect(card).toHaveCount(1);
  await expect(header("age")).toHaveAttribute("data-agent-touched", "1");
  await toast("Agent: add scale (age)").getByRole("button", { name: "Undo" }).click();
  expect(await stepOps(page)).toEqual([]);
  await expect(touched).toHaveCount(0, { timeout: 6_000 });
});

/** #89: curated "set one thing" commands on an open window; each Undo restores the previous value. */
test("issue 89: set_target / set_dist_by / set_tool_params, bad_command, Undo", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  await published(request, page);
  const field = (name: "targetColumn" | "distBy") =>
    page.evaluate((k) => window.__DTK_STATE__?.()?.[k], name);
  const toast = (text: string) => page.getByRole("status").filter({ hasText: text });
  const header = (col: string) => page.getByRole("button", { name: new RegExp(`^${col}, `) });

  // set_target: unknown column refused; known one set, column touched, Undo restores.
  const ghost = await send(request, page, { type: "set_target", column: "ghost" });
  expect(ghost).toMatchObject({ ok: false });
  expect(ghost.error).toMatch(/^bad_command: unknown column/);
  const target0 = await field("targetColumn");
  const t = await send(request, page, { type: "set_target", column: "sessions" });
  expect(t.ok).toBe(true);
  await expect.poll(() => field("targetColumn")).toBe("sessions");
  await expect(header("sessions")).toHaveAttribute("data-agent-touched", "1");
  await toast("Agent: target set to sessions").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => field("targetColumn")).toBe(target0);

  // set_dist_by on the open Distribution window; null clears; Undo goes back.
  const opened = await send(request, page, {
    type: "open_window", tool: "dist", params: { column: "age" },
  });
  expect(opened.ok).toBe(true);
  const by = await send(request, page, { type: "set_dist_by", by: "sessions" });
  expect(by.ok).toBe(true);
  await expect.poll(() => field("distBy")).toBe("sessions");
  await expect(page.locator('[data-tool="dist"]')).toHaveAttribute("data-agent-touched", "1");
  await toast("Agent: Distribution split by sessions").getByRole("button", { name: "Undo" }).click();
  expect(await field("distBy")).toBeNull();

  // set_tool_params: unknown key refused; bins applied to the window; Undo clears.
  const dist = page.locator('[data-tool="dist"]');
  const unknown = await send(request, page, {
    type: "set_tool_params", tool: "dist", column: "age", params: { nope: 1 },
  });
  expect(unknown).toMatchObject({ ok: false });
  expect(unknown.error).toMatch(/^bad_command: unknown param "nope"/);
  const set = await send(request, page, {
    type: "set_tool_params", tool: "dist", column: "age", params: { bins: 12 },
  });
  expect(set.ok).toBe(true);
  await expect(dist.locator("[data-dist-bins]")).toHaveAttribute("data-dist-bins", "12", {
    timeout: 30_000,
  });
  await toast("Agent: Distribution params: bins=12").getByRole("button", { name: "Undo" }).click();
  await expect(dist.locator("[data-dist-bins]")).not.toHaveAttribute("data-dist-bins", "12", {
    timeout: 30_000,
  });
});

/** #90: pick_row / pick_cell / clear_selection publish `selection`, highlight, Undo restores. */
test("issue 90: pick_row, pick_cell, clear_selection, bad_command, Undo", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  await published(request, page);
  const toast = (text: string) => page.getByRole("status").filter({ hasText: text });
  const rid = await page.locator("[data-rid]").first().getAttribute("data-rid");
  const rowId = Number(rid);

  const ghost = await send(request, page, { type: "pick_cell", rid: rowId, column: "ghost" });
  expect(ghost).toMatchObject({ ok: false });
  expect(ghost.error).toMatch(/^bad_command: unknown column/);

  expect((await send(request, page, { type: "pick_row", rid: rowId })).ok).toBe(true);
  expect((await published(request, page, (c) => c.selection?.row === rowId)).selection.row).toBe(rowId);
  await expect(page.locator(`[data-rid="${rowId}"]`)).toHaveAttribute("data-agent-touched", "1");

  const cell = await send(request, page, { type: "pick_cell", rid: rowId, column: "age" });
  expect(cell.ok).toBe(true);
  const ctx = await published(request, page, (c) => c.selection?.cell?.col === "age");
  expect(ctx.selection.cell).toEqual({ rid: rowId, col: "age" });

  await toast("Agent: selected cell age").getByRole("button", { name: "Undo" }).click();
  await published(request, page, (c) => c.selection?.row === rowId && c.selection?.cell === null);

  expect((await send(request, page, { type: "clear_selection" })).ok).toBe(true);
  await published(request, page, (c) => c.selection?.row === null && c.selection?.cell === null);
});
