import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { Step } from "../src/api/types";
import { churnWorkspace, openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#153 — stable step ids and `propose_steps` by id: an
 * agent command rebases over the user's other edits, and is acked `stale`
 * (naming the step) when the user removed or changed a step it targets.
 * Part 1 posts commands straight to `POST /api/ui/commands`; part 2 plays
 * the same conflict through the engine's `stub` chat pack.
 */
const PORT = process.env.DTK_E2E_API_PORT ?? "8766";
const API = `http://127.0.0.1:${PORT}/api/ui`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

type Ack = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const impute: Step = { op: "impute", target: "both", params: { columns: ["age"], strategy: "median" } };
const scale: Step = { op: "scale", target: "both", params: { columns: ["age"] } };
const scaleSessions: Step = { op: "scale", target: "both", params: { columns: ["sessions"] } };

const steps = (page: Page) =>
  page.evaluate(() => (window.__DTK_STATE__?.()?.workspace?.steps ?? []) as Step[]);

const identity = (page: Page) =>
  page.getByLabel("Data grid").getAttribute("data-identity-current");

async function send(request: APIRequestContext, page: Page, cmd: Record<string, unknown>): Promise<Ack> {
  const sid = await page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);
  const res = await request.post(`${API}/commands`, {
    headers: AUTH,
    data: { ...cmd, session: sid, timeout: 30 },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as Ack;
}

async function storedSteps(request: APIRequestContext): Promise<Step[]> {
  const res = await request.get(`http://127.0.0.1:${PORT}/api/workspaces/churn`);
  return ((await res.json()) as { steps: Step[] }).steps;
}

/** Open churn with `initial` steps (no ids: Studio fills s1, s2… like the engine). */
async function openWithSteps(page: Page, initial: Step[]) {
  await openWorkbench(page, true);
  await page.evaluate((workspace) => {
    window.__DTK_DISPATCH__!({ type: "SET_WORKSPACE", workspace });
  }, { ...churnWorkspace(), steps: initial });
  await waitForGridReady(page);
}

/** Remove the first step card labelled `label` with its × button. */
const removeStep = (page: Page, label: string) =>
  page
    .locator(".pipeline-node-rel", { has: page.locator(".pipeline-node", { hasText: label }) })
    .first()
    .getByRole("button", { name: "Remove this step and replay" })
    .click();

test("issue 153: ids are filled on load, stored, and kept across reload and edits", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWithSteps(page, [impute, scale]);
  expect((await steps(page)).map((s) => s.id)).toEqual(["s1", "s2"]);
  await expect.poll(async () => (await storedSteps(request)).map((s) => s.id), { timeout: 15_000 })
    .toEqual(["s1", "s2"]);

  // A new step gets a fresh id; ids survive a reload.
  await page.evaluate((step) => window.__DTK_DISPATCH__!({ type: "ADD_STEP", step }), scaleSessions);
  await expect.poll(async () => (await steps(page)).length).toBe(3);
  const ids = (await steps(page)).map((s) => s.id);
  expect(ids[2]).toMatch(/^s[0-9a-f]{8}$/);
  await expect.poll(async () => (await storedSteps(request)).map((s) => s.id), { timeout: 15_000 })
    .toEqual(ids);
  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await waitForGridReady(page);
  expect((await steps(page)).map((s) => s.id)).toEqual(ids);
});

test("issue 153: a command by id rebases over user edits; a removed or changed target is stale", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWithSteps(page, [impute, scale]);
  const seen = await steps(page);
  const base = Object.fromEntries(seen.map(({ id, op, target, params }) => [id, { op, target, params }]));
  const baseIdentity = await identity(page);

  // The user adds a step: the frame moved, the agent's targets did not.
  await page.evaluate((step) => window.__DTK_DISPATCH__!({ type: "ADD_STEP", step }), scaleSessions);
  await waitForGridReady(page);
  const rebased = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: baseIdentity, base_steps: base,
    ops: [
      { replace: { id: "s2", step: { op: "scale", target: "both", params: { columns: ["age"], method: "minmax" } } } },
      { add: { step: { op: "impute", target: "both", params: { columns: ["sessions"], strategy: "mean" } } } },
    ],
  });
  expect(rebased).toMatchObject({ ok: true, added_ids: [expect.stringMatching(/^s[0-9a-f]{8}$/)] });
  const after = await steps(page);
  expect(after.map((s) => s.id)).toEqual(["s1", "s2", after[2]!.id, rebased.added_ids[0]]);
  expect(after[1]!.params).toEqual({ columns: ["age"], method: "minmax" });
  await waitForGridReady(page);

  // The user removes s2 (×) and edits s1, then the agent targets both: stale, nothing applied.
  await removeStep(page, "Scale");
  await expect.poll(async () => (await steps(page)).map((s) => s.id)).not.toContain("s2");
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({
      type: "REPLACE_STEP", index: 0,
      step: { op: "impute", target: "both", params: { columns: ["age"], strategy: "mean" } },
    }),
  );
  await waitForGridReady(page);
  const before = await steps(page);
  const stale = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: baseIdentity, base_steps: base,
    ops: [{ replace: { id: "s1", step: scale } }, { remove: { id: "s2" } }],
  });
  expect(stale).toMatchObject({
    ok: false,
    error: "stale: step s1 (impute) changed by the user; step s2 (scale) removed",
    stale: [
      { id: "s1", reason: "changed", step: { id: "s1", op: "impute", params: { strategy: "mean" } } },
      { id: "s2", reason: "removed" },
    ],
  });
  expect(await steps(page)).toEqual(before);
  await expect(page.getByLabel("Agent proposal")).toHaveCount(0);
});

test("issue 153: stub agent mid-task, the user removes the step it read, its remove is stale", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  const res = await request.get(`${API}/agent`, { headers: AUTH });
  test.skip(res.status() === 404, "engine without the agent chat routes (#67)");

  await openWithSteps(page, [impute, scale]);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  const say = async (text: string) => {
    await panel.getByLabel("Message the agent").fill(text);
    await panel.getByRole("button", { name: "Send" }).click();
    await expect(panel.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 30_000 });
  };
  const reply = panel.locator('[data-role="assistant"]').last();

  // The agent reads the workspace and learns the ids.
  await say("read the workspace");
  await expect(reply).toHaveText("stub: steps s1 impute, s2 scale", { timeout: 30_000 });

  // Meanwhile the user removes Scale.
  await removeStep(page, "Scale");
  await expect.poll(async () => (await steps(page)).map((s) => s.op)).toEqual(["impute"]);
  await waitForGridReady(page);

  // The agent's remove by the id it saw: acked stale with the reason, no review, nothing applied.
  // The turn's Studio note (#151) already told the agent s2 is gone, so its
  // base_steps lacks s2 and Studio cannot name the op: "(scale)" is optional.
  await say("remove step s2");
  await expect(panel.locator('[data-tool-call="propose_steps"]').last()).toContainText("remove step s2");
  await expect(reply).toHaveText(/^stub: stale: step s2 (\(scale\) )?removed\s*$/, { timeout: 30_000 });
  await expect(page.getByLabel("Agent proposal")).toHaveCount(0);
  expect((await steps(page)).map((s) => s.id)).toEqual(["s1"]);
});
