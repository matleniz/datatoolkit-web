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
  /** null while the command waits in Studio's review banner. */
  ok: boolean | null;
  error?: string;
  identity?: string;
  pending?: "review";
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

async function send(
  request: APIRequestContext,
  page: Page,
  cmd: Record<string, unknown>,
  timeout = 30,
) {
  const sid = await session(page);
  const res = await request.post(`${API}/commands`, {
    headers: AUTH,
    data: { ...cmd, session: sid, timeout },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as Ack;
}

/** `GET /api/ui/commands/{id}`: the final ack, or the pending one under review. */
async function commandStatus(request: APIRequestContext, id: string): Promise<Ack> {
  const res = await request.get(`${API}/commands/${id}`, { headers: AUTH });
  expect(res.ok()).toBe(true);
  return (await res.json()) as Ack;
}

/** The final ack of a reviewed command, once the user decided. */
async function settled(request: APIRequestContext, id: string): Promise<Ack> {
  await expect.poll(async () => (await commandStatus(request, id)).ok, { timeout: 30_000 }).not.toBeNull();
  return commandStatus(request, id);
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

  // The agent's call returns at once: pending review (datatoolkit-issues#97).
  // Dismiss → the final ack is rejected, nothing applied.
  const dismissed = await send(request, page, drop("support_calls"));
  expect(dismissed).toEqual({ id: dismissed.id, ok: null, pending: "review" });
  await expect(review).toBeVisible();
  await expect(review).toContainText("drop_columns (support_calls)");
  expect(await stepOps(page)).toEqual([]);
  await review.getByRole("button", { name: "Dismiss" }).click();
  expect(await settled(request, dismissed.id)).toMatchObject({ ok: false, error: "rejected" });
  await expect(review).toBeHidden();
  expect(await stepOps(page)).toEqual([]);

  // Apply → applied, final ack with the new identity.
  const applied = await send(request, page, drop("support_calls"));
  expect(applied.pending).toBe("review");
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Apply" }).click();
  const ack = await settled(request, applied.id);
  expect(ack.ok).toBe(true);
  expect(ack.identity).not.toBe(ctx0.identity);
  expect(await stepOps(page)).toEqual(["drop_columns"]);
  await waitForGridReady(page);
  await expect(page.getByRole("button", { name: "support_calls, number" })).toHaveCount(0);

  // Removing a step is destructive too.
  const removal = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: ack.identity,
    ops: [{ remove: { index: 0 } }],
  });
  await expect(review).toContainText("remove step 1 (drop_columns)");
  await review.getByRole("button", { name: "Apply" }).click();
  expect((await settled(request, removal.id)).ok).toBe(true);
  expect(await stepOps(page)).toEqual([]);
});

/** #97: a review outlives the command timeout and does not block the queue. */
test("issue 97: pending review ack, queue free meanwhile, Apply after the timeout", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  const ctx0 = await published(request, page);
  const review = page.getByLabel("Agent proposal");

  const pending = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: ctx0.identity,
    ops: [{ add: { step: { op: "drop_columns", target: "both", params: { columns: ["support_calls"] } } } }],
  }, 2);
  expect(pending).toEqual({ id: pending.id, ok: null, pending: "review" });
  await expect(review).toBeVisible();

  // View commands run while the banner is open; another proposal is busy.
  const sel = await send(request, page, { type: "select_columns", columns: ["age"] });
  expect(sel).toMatchObject({ ok: true });
  const busy = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: ctx0.identity,
    ops: [{ add: { step: scale } }],
  });
  expect(busy).toMatchObject({ ok: false, error: "busy" });

  // Past the 2 s command timeout the command is still under review, not timed out.
  await page.waitForTimeout(3_000);
  expect(await commandStatus(request, pending.id)).toMatchObject({ ok: null, pending: "review" });
  await review.getByRole("button", { name: "Apply" }).click();
  const final = await settled(request, pending.id);
  expect(final).toMatchObject({ ok: true });
  expect(final.identity).not.toBe(ctx0.identity);
  expect(await stepOps(page)).toEqual(["drop_columns"]);
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

test("issue 82: open_window opens the report-only analyses (duplicates, advisor, overview, inconsistencies)", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  await published(request, page);

  for (const tool of ["dataset_overview", "duplicates"]) {
    const ack = await send(request, page, { type: "open_window", tool });
    expect(ack.ok).toBe(true);
    const win = page.locator(`[data-tool="${tool}"]`);
    await expect(win).toBeVisible();
    await expect(win.locator(`[data-engine-key="${tool}"]`)).toBeVisible({ timeout: 60_000 });
  }

  // The rail opens the remaining ones; Suggestions links to a full report.
  await page.getByRole("button", { name: "Preprocessing advisor" }).click();
  await expect(page.locator('[data-tool="preprocessing_advisor"]')).toBeVisible();
  await page.getByRole("button", { name: "Inconsistencies" }).click();
  await expect(page.locator('[data-tool="inconsistencies"]')).toBeVisible();
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

/** #93: add_variable persists before the ack; a formula step reads it from its own params.variables. */
test("issue 93: add_variable, formula step using @name, Undo both", async ({ page, request }) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  await published(request, page);
  const toast = (text: string) => page.getByRole("status").filter({ hasText: text });
  const variables = () =>
    page.evaluate(() => window.__DTK_STATE__?.()?.workspace?.variables ?? []);
  const header = (col: string) => page.getByRole("button", { name: new RegExp(`^${col}, `) });

  for (const [bad, error] of [
    [{ name: "mu", stat: "mean", column: "ghost" }, /^bad_command: unknown column/],
    [{ name: "mu", stat: "mode", column: "age" }, /^bad_command: stat must be one of/],
    [{ name: "1mu", stat: "mean", column: "age" }, /^bad_command: name must be an identifier/],
  ] as const) {
    const ack = await send(request, page, { type: "add_variable", ...bad });
    expect(ack).toMatchObject({ ok: false });
    expect(ack.error).toMatch(error);
  }
  expect(await variables()).toEqual([]);

  const added = await send(request, page, {
    type: "add_variable", name: "mu", stat: "mean", column: "age",
  });
  expect(added.ok).toBe(true);
  expect(await variables()).toEqual([{ name: "mu", stat: "mean", column: "age" }]);
  await expect(header("age")).toHaveAttribute("data-agent-touched", "1");
  const dup = await send(request, page, {
    type: "add_variable", name: "mu", stat: "max", column: "age",
  });
  expect(dup.error).toBe('bad_command: variable "mu" already exists');

  // A formula step carries its variables in its own params (the engine resolves nothing else).
  const centered = {
    op: "formula", target: "both",
    params: {
      name: "age_c", expr: "age - @mu",
      variables: [{ name: "mu", stat: "mean", column: "age" }],
    },
  };
  const ctx = await published(request, page);
  const step = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: ctx.identity,
    ops: [{ add: { step: centered } }],
  });
  expect(step.ok).toBe(true);
  expect(await stepOps(page)).toEqual(["formula"]);

  // One toast at a time: Undo the step (the variable stays), then re-add and Undo the variable.
  await toast("Agent: add formula").getByRole("button", { name: "Undo" }).click();
  expect(await stepOps(page)).toEqual([]);
  expect(await variables()).toHaveLength(1);
  const reMu = { name: "sigma", stat: "std", column: "age" };
  expect((await send(request, page, { type: "add_variable", ...reMu })).ok).toBe(true);
  await toast("Agent: variable @sigma = std(age)").getByRole("button", { name: "Undo" }).click();
  expect((await variables()).map((v) => v.name)).toEqual(["mu"]);
});

/** #92: draft_chart fills the builder (nothing saved); add_chart saves before the ack; Undo removes it. */
test("issue 92: draft_chart a histogram of age, add_chart it, Undo", async ({ page, request }) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  await published(request, page);
  const toast = (text: string) => page.getByRole("status").filter({ hasText: text });
  const charts = () => page.evaluate(() => window.__DTK_STATE__?.()?.workspace?.charts ?? []);
  const draft = () => page.evaluate(() => window.__DTK_STATE__?.()?.chartDraft ?? null);
  const stored = async () => {
    const res = await request.get(`http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/workspaces/churn`);
    return ((await res.json()) as { charts?: { name: string }[] }).charts ?? [];
  };

  const drafted = await send(request, page, {
    type: "draft_chart", params: { chart: "histogram", x: "age", bins: 20 },
  });
  expect(drafted.ok).toBe(true);
  await expect(page.locator('[data-tool="chart"]')).toBeVisible();
  expect(await draft()).toMatchObject({ chart: "histogram", x: "age", bins: 20 });
  expect(await charts()).toEqual([]);

  const ghost = await send(request, page, { type: "add_chart", name: "g", params: { x: "ghost" } });
  expect(ghost.error).toMatch(/^bad_command: unknown column/);

  const added = await send(request, page, {
    type: "add_chart", name: "age hist", params: { chart: "histogram", x: "age", bins: 20 },
  });
  expect(added.ok).toBe(true);
  expect((await charts()).map((c) => c.name)).toEqual(["age hist"]);
  expect((await stored()).map((c) => c.name)).toEqual(["age hist"]);
  const dup = await send(request, page, { type: "add_chart", name: "age hist", params: { x: "age" } });
  expect(dup.error).toBe('bad_command: duplicate chart name "age hist"');

  await toast("Agent: saved chart age hist").getByRole("button", { name: "Undo" }).click();
  expect(await charts()).toEqual([]);
  await expect.poll(stored).toEqual([]);
});

/** #94: fill_editor opens / fills the editor (nothing applied); the user's Apply adds the step. */
test("issue 94: fill_editor an impute editor, user Apply, edit_step, Undo", async ({ page, request }) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  await published(request, page);
  const editor = page.getByLabel("Step editor");
  const state = () => page.evaluate(() => window.__DTK_STATE__?.()?.editor ?? null);

  const bad = await send(request, page, { type: "fill_editor", params: { strategy: "mean" } });
  expect(bad.error).toBe("bad_command: op is required to open the editor");
  const ghost = await send(request, page, { type: "fill_editor", op: "no_such_op" });
  expect(ghost.error).toBe('bad_command: unknown op "no_such_op"');

  const ctx = await published(request, page);
  const opened = await send(request, page, {
    type: "fill_editor", op: "impute", params: { columns: ["age"], strategy: "median" },
  });
  expect(opened).toMatchObject({ ok: true, identity: ctx.identity });
  await expect.poll(state).toMatchObject({ op: "impute", params: { columns: ["age"], strategy: "median" } });
  expect(await stepOps(page)).toEqual([]);
  await expect(editor).toBeVisible();

  const patched = await send(request, page, { type: "fill_editor", target: "train" });
  expect(patched).toMatchObject({ ok: true, identity: ctx.identity });
  await expect.poll(state).toMatchObject({ target: "train" });
  expect(await stepOps(page)).toEqual([]);

  // The user previews and clicks Apply.
  const apply = editor.getByRole("button", { name: "Apply step" });
  await expect(apply).toBeEnabled({ timeout: 30_000 });
  await apply.click();
  await expect.poll(() => stepOps(page), { timeout: 30_000 }).toEqual(["impute"]);

  // edit_step opens it (op change refused); Undo closes it.
  const edit = await send(request, page, { type: "edit_step", index: 0 });
  expect(edit.ok).toBe(true);
  await expect.poll(state).toMatchObject({ op: "impute", editIndex: 0 });
  expect((await send(request, page, { type: "edit_step", index: 5 })).error)
    .toBe("bad_command: no step at index 5");
  const op = await send(request, page, { type: "fill_editor", op: "scale" });
  expect(op.error).toMatch(/^bad_command: cannot change the op/);
  await page.getByRole("status").filter({ hasText: "editing step 1" }).getByRole("button", { name: "Undo" }).click();
  await expect.poll(state).toBeNull();
});
