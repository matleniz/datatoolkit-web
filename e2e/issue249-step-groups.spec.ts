import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Group, Step, Workspace } from "../src/api/types";
import { sameGroups, validateGroups } from "../src/state/stepGroups";
import { churnWorkspace, fixturesDir, openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#249 (PR A, data layer): the workspace PUT always carries
 * the step groups, they follow every step edit and undo, the engine accepts
 * them (no 422), and a workspace stored before groups gets one singleton group
 * per step, with nothing else changed. Real engine, temp DTK_HOME.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api`;
const HOME = process.env.DTK_E2E_HOME!;

const saved = (page: Page) =>
  page.evaluate(async () => {
    await window.__DTK_WORKSPACE_SAVED__;
  });
const local = (page: Page) =>
  page.evaluate(() => {
    const w = window.__DTK_STATE__!().workspace!;
    return { steps: w.steps, groups: w.groups };
  });
const stored = async (request: APIRequestContext, name: string): Promise<Workspace> =>
  (await (await request.get(`${API}/workspaces/${name}`)).json()) as Workspace;
const onDisk = (name: string): Workspace =>
  JSON.parse(readFileSync(join(HOME, "workspaces", `${name}.json`), "utf-8")) as Workspace;
const shape = (groups: Group[]) => groups.map((g) => g.step_ids.join("+"));

/** PUTs of workspace `name` seen by the page, from now on. */
function countPuts(page: Page, name: string): () => number {
  let n = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && new RegExp(`/api/workspaces/${name}$`).test(r.url())) n += 1;
  });
  return () => n;
}

/** Let the page run `ms` (autosave debounce + a margin) so a stray PUT would show. */
const idle = (page: Page, ms: number) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);

const impute: Step = { op: "impute", target: "both", params: { columns: ["age"], strategy: "median" } };
const scale: Step = { op: "scale", target: "both", params: { columns: ["age"] } };
const drop: Step = { op: "drop_columns", target: "both", params: { columns: ["signup_date"] } };

/** The engine, the disk and the screen agree, and the groups are a valid partition. */
async function expectConsistent(page: Page, request: APIRequestContext, name: string) {
  // The autosave is debounced: wait for the file to hold what is on screen.
  await expect
    .poll(
      async () => {
        const screen = await local(page);
        const file = onDisk(name);
        return (
          JSON.stringify(file.steps.map((s) => s.id)) === JSON.stringify(screen.steps.map((s) => s.id)) &&
          sameGroups(file.groups, screen.groups)
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const screen = await local(page);
  const api = await stored(request, name);
  for (const ws of [api, onDisk(name)]) {
    expect(validateGroups(ws.steps, ws.groups)).toBeNull();
    expect(ws.steps.map((s) => s.id)).toEqual(screen.steps.map((s) => s.id));
    expect(sameGroups(ws.groups, screen.groups)).toBe(true);
  }
  return screen;
}

test("issue 249: add, delete in the middle, undo, reload — groups valid, no 422, no spurious PUT", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  const puts = countPuts(page, "churn");
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "PUT" && r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
  });

  for (const [i, step] of [impute, scale, drop].entries()) {
    await page.evaluate((s) => window.__DTK_DISPATCH__!({ type: "ADD_STEP", step: s }), step);
    await expect.poll(async () => (await local(page)).steps.length).toBe(i + 1);
    await expectConsistent(page, request, "churn");
  }
  let screen = await local(page);
  expect(screen.groups).toHaveLength(3);
  expect(screen.groups.every((g) => g.step_ids.length === 1 && g.origin === "auto")).toBe(true);
  expect(screen.groups.map((g) => g.name)).toEqual(["impute both", "scale both", "drop_columns both"]);
  // The singleton id is the engine's rule: g + the step id without its "s".
  expect(screen.groups.map((g) => g.id)).toEqual(screen.steps.map((s) => `g${s.id!.slice(1)}`));
  const before = screen.groups;

  // Delete the middle step with its × button, then undo.
  const scaleNode = page.locator(".pipeline-node", { hasText: "Scale" });
  await page
    .locator(".pipeline-node-rel", { has: scaleNode })
    .getByRole("button", { name: "Remove this step and replay" })
    .click();
  await expect(scaleNode).toHaveCount(0);
  screen = await expectConsistent(page, request, "churn");
  expect(screen.steps.map((s) => s.op)).toEqual(["impute", "drop_columns"]);
  expect(screen.groups.map((g) => g.id)).toEqual([before[0]!.id, before[2]!.id]);

  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  await expect(scaleNode).toHaveCount(1);
  screen = await expectConsistent(page, request, "churn");
  expect(screen.groups).toEqual(before);

  // Reload: the groups come back from the file as they were, and Studio PUTs nothing.
  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await waitForGridReady(page);
  const putsBeforeIdle = puts();
  const reloaded = await local(page);
  expect(reloaded.steps.map((s) => s.id)).toEqual(screen.steps.map((s) => s.id));
  expect(reloaded.groups).toEqual(screen.groups);
  await idle(page, 1500);
  expect(puts()).toBe(putsBeforeIdle);
  expect(failures).toEqual([]);
});

test("issue 249: a multi-step group shrinks when a step leaves it, and undo gives it back", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "PUT" && r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
  });
  const steps = [impute, scale, drop].map((s, i) => ({ ...s, id: `s${i + 1}` }));
  const groups: Group[] = [
    { id: "gimpute1", name: "Clean age", intent: "median then scale\nin one go", step_ids: ["s1", "s2"], origin: "manual" },
    { id: "g3", name: "drop_columns both", intent: "", step_ids: ["s3"], origin: "auto" },
  ];
  await page.evaluate(
    (workspace) => window.__DTK_DISPATCH__!({ type: "SET_WORKSPACE", workspace }),
    { ...churnWorkspace(), steps, groups },
  );
  await waitForGridReady(page);
  await expectConsistent(page, request, "churn");
  expect((await stored(request, "churn")).groups).toEqual(groups.map((g) => ({ ...g, produced_by: null })));

  // The two-step group is one collapsed row since PR B: open it to reach its steps.
  await page.getByRole("button", { name: "Expand group Clean age" }).click();
  // (the group header also says "scale" in its intent: match the step by version)
  const scaleNode = page.locator(".pipeline-node", { hasText: /^v2\s*Scale/ });
  await page
    .locator(".pipeline-node-rel", { has: scaleNode })
    .getByRole("button", { name: "Remove this step and replay" })
    .click();
  await expect(scaleNode).toHaveCount(0);
  const after = await expectConsistent(page, request, "churn");
  expect(shape(after.groups)).toEqual(["s1", "s3"]);
  expect(after.groups[0]).toMatchObject({ id: "gimpute1", name: "Clean age", intent: "median then scale\nin one go" });

  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  await expect(scaleNode).toHaveCount(1);
  const undone = await expectConsistent(page, request, "churn");
  expect(undone.groups).toEqual(groups);
  expect(failures).toEqual([]);
});

test("issue 249: a group 422 shows the group and the step in the save banner", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  await page.route(/\/api\/workspaces\/churn$/, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    return route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        type: "KeyParamsError",
        message: "group 'g7' names unknown step id 's9'",
        details: [{ loc: [], msg: "Value error", type: "value_error" }],
        detail: { rule: "unknown_step", group_id: "g7", step_id: "s9" },
      }),
    });
  });
  await page.evaluate((s) => window.__DTK_DISPATCH__!({ type: "ADD_STEP", step: s }), drop);
  const banner = page.locator("[data-save-failed]");
  await expect(banner).toContainText("Not saved: Step groups refused by the engine (group g7, step s9)", {
    timeout: 15_000,
  });
  await expect(banner).toContainText("a group names a step that does not exist");
});

test("issue 249: parkison (63 steps) opens and saves as 63 singleton groups, nothing else changed", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  // A 63-step workspace in the pre-groups file format, built over a repo fixture
  // and written into the temp home (never the developer's ~/.datatoolkit).
  const csv = (path: string) => ({
    kind: "csv", path, sep: ",", encoding: "utf-8", decimal: ".", skiprows: 0, header: 0,
    mixed_sep: "error", na_values: null, dtype: null, parse_dates: null, usecols: null,
    on_bad_lines: "error", keep_leading_zeros: true,
  });
  const wide = join(fixturesDir, "wide_320_cols.csv");
  const dataset = { x: csv(wide), y: null, target_column: null };
  const fileSteps = Array.from({ length: 63 }, (_, i) => ({
    id: `s${(0xa000 + i).toString(16)}`,
    op: "drop_columns",
    target: "both",
    params: { columns: [`f${String(i).padStart(3, "0")}`] },
    note: null,
  }));
  const copied = JSON.stringify({
    name: "parkison",
    datasets: { train: dataset, test: dataset },
    label: { mode: "order", key: null },
    label_last: false,
    merges: [],
    variables: [],
    charts: [],
    steps: fileSteps,
    notes: { workspace: null, columns: {} },
    documents: [],
    memory: [],
    id_counters: { d: 0, m: 0 },
  });
  const before = JSON.parse(copied) as Workspace & Record<string, unknown>;
  expect(before.steps).toHaveLength(63);
  expect(before.groups).toBeUndefined();
  mkdirSync(join(HOME, "workspaces"), { recursive: true });
  writeFileSync(join(HOME, "workspaces", "parkison.json"), copied, "utf-8");

  // Open it the way a user's next visit does, and count the PUTs.
  await page.addInitScript(() => localStorage.setItem("dtk.lastWorkspace", "parkison"));
  const puts = countPuts(page, "parkison");
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await expect.poll(async () => (await local(page)).steps.length, { timeout: 30_000 }).toBe(63);
  await idle(page, 2000);
  expect(puts()).toBe(0); // loading alone writes nothing
  const opened = await local(page);
  expect(opened.groups).toHaveLength(63);
  expect(validateGroups(opened.steps, opened.groups)).toBeNull();

  // The stored file has no groups yet; the API (normalised on load) shows 63 singletons.
  expect(onDisk("parkison").groups).toBeUndefined();
  const viaApi = await stored(request, "parkison");
  expect(sameGroups(viaApi.groups, opened.groups)).toBe(true);

  // Save: change one step note, then undo it — the file is written with the groups.
  const first = opened.steps[0]!.id!;
  await page.evaluate((id) => window.__DTK_DISPATCH__!({ type: "SET_STEP_NOTE", id, text: "e2e" }), first);
  await expect.poll(puts, { timeout: 15_000 }).toBe(1);
  await page.evaluate((id) => window.__DTK_DISPATCH__!({ type: "SET_STEP_NOTE", id, text: "" }), first);
  await expect.poll(puts, { timeout: 15_000 }).toBe(2);
  await saved(page);
  await idle(page, 1500);
  expect(puts()).toBe(2); // one PUT per edit, none echoed back after the answer

  const after = onDisk("parkison") as Workspace & Record<string, unknown>;
  expect(after.groups).toHaveLength(63);
  expect(validateGroups(after.steps, after.groups)).toBeNull();
  expect(after.groups.every((g) => g.step_ids.length === 1 && g.origin === "auto" && g.intent === "")).toBe(true);
  expect(after.groups.map((g) => g.id)).toEqual(after.steps.map((s) => `g${s.id!.slice(1)}`));
  // Everything but `groups` is what it was (the note edit was reverted).
  // The engine may add the source `engine` field ("pandas" is its default and is
  // stored explicitly by engines with the DuckDB reader): ignore that one default.
  const plain = (w: Record<string, unknown>) =>
    JSON.parse(JSON.stringify(w, (k, v) => (k === "engine" && v === "pandas" ? undefined : v)));
  const { groups: _g, ...rest } = after;
  const { groups: _b, ...was } = before;
  expect(plain(rest)).toEqual(plain(was));
  expect(basename(dirname(join(HOME, "workspaces", "parkison.json")))).toBe("workspaces");
});
