import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Step, Workspace } from "../src/api/types";
import { validateGroups } from "../src/state/stepGroups";
import { expectNoA11yViolations } from "./a11y";
import { churnWorkspace, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#249 (PR C): manual group / ungroup / rename in the step
 * list, and the automatic group of an agent proposal. Everything goes through
 * the real engine: workspaces are written with its HTTP API (temp DTK_HOME),
 * the PUTs Studio sends are recorded and the stored file is read back. The
 * agent batch uses the real UI bridge (`POST /api/ui/commands`), i.e. the code
 * path of an applied `propose_steps`.
 */
const PORT = process.env.DTK_E2E_API_PORT ?? "8766";
const API = `http://127.0.0.1:${PORT}/api`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };
const HOME = process.env.DTK_E2E_HOME!;

const step = (id: string, op: string, params: Record<string, unknown>): Step => ({ id, op, target: "both", params });
const steps: Step[] = [
  step("s1", "formula", { name: "age_plus_one", expr: "age + 1" }),
  step("s2", "impute", { columns: ["age"], strategy: "median" }),
  step("s3", "scale", { columns: ["age"] }),
  step("s4", "scale", { columns: ["age_plus_one"] }),
];

const bar = (page: Page) => page.getByRole("region", { name: "Pipeline" });
const onDisk = (name: string): Workspace =>
  JSON.parse(readFileSync(join(HOME, "workspaces", `${name}.json`), "utf-8")) as Workspace;
const shapeOf = (w: Workspace) => w.groups.map((g) => g.step_ids.join("+"));

function recordPuts(page: Page, name: string): Workspace[] {
  const bodies: Workspace[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith(`/api/workspaces/${name}`)) {
      bodies.push(JSON.parse(r.postData() ?? "{}") as Workspace);
    }
  });
  return bodies;
}

async function setup(page: Page, request: APIRequestContext, name: string): Promise<Workspace[]> {
  // No `groups`: the engine normalises to four singleton groups.
  const res = await request.put(`${API}/workspaces/${name}`, { data: { ...churnWorkspace(), name, steps } });
  expect(res.status()).toBe(200);
  const puts = recordPuts(page, name);
  await page.addInitScript((n) => localStorage.setItem("dtk.lastWorkspace", n), name);
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await waitForGridReady(page);
  return puts;
}

async function expectPuts(puts: Workspace[], count: number): Promise<Workspace> {
  await expect.poll(() => puts.length, { timeout: 15_000 }).toBe(count);
  const last = puts.at(-1)!;
  expect(validateGroups(last.steps, last.groups)).toBeNull();
  return last;
}

test("issue 249c: group two rows, rename, ungroup, each one PUT and undoable; bad names send nothing", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const puts = await setup(page, request, "g249c");
  await expect(bar(page).locator(".pipeline-pick")).toHaveCount(0); // plain list: no checkbox until asked
  let n = 0;

  // Non-contiguous selection: the action says why it is off.
  await bar(page).getByRole("button", { name: "Group rows…" }).click();
  await bar(page).getByLabel("Select step 1 for grouping").check();
  await bar(page).getByLabel("Select step 4 for grouping").check();
  const groupBtn = bar(page).getByRole("button", { name: "Group 2 rows" });
  await expect(groupBtn).toHaveAttribute("aria-disabled", "true");
  await expect(bar(page).locator("#pipeline-group-hint")).toContainText("not side by side");
  await expect(groupBtn).toHaveAccessibleDescription(/not side by side/);
  await groupBtn.click({ force: true }); // aria-disabled: Playwright would wait for it forever
  await expect(page.getByRole("form", { name: "Name the new group" })).toHaveCount(0);
  await expectNoA11yViolations(page, "select mode, rows ticked, non-contiguous (#249c)");

  // Contiguous: rows 2 and 3.
  await bar(page).getByLabel("Select step 1 for grouping").uncheck();
  await bar(page).getByLabel("Select step 4 for grouping").uncheck();
  await bar(page).getByLabel("Select step 2 for grouping").check();
  await bar(page).getByLabel("Select step 3 for grouping").check();
  await bar(page).getByRole("button", { name: "Group 2 rows" }).click();
  const form = page.getByRole("form", { name: "Name the new group" });
  const name = form.getByRole("textbox", { name: "Group name" });
  await expect(name).toBeFocused();
  await expectNoA11yViolations(page, "group name form (#249c)");

  // Invalid names: inline error, no PUT.
  for (const bad of ["", "   ", "x".repeat(81)]) {
    await name.fill(bad);
    await name.press("Enter");
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(name).toHaveAttribute("aria-invalid", "true");
  }
  await expectNoA11yViolations(page, "group name form, error shown (#249c)");
  expect(puts.length).toBe(n);

  // Escape cancels and puts the focus back on the first ticked row; still ticked.
  await name.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(bar(page).locator("[data-row-first-step='s2'] button").first()).toBeFocused();
  expect(puts.length).toBe(n);

  // Enter saves: ONE PUT with the manual group, focus on the new group.
  await bar(page).getByRole("button", { name: "Group 2 rows" }).click();
  await name.fill("  Prepare age ");
  await form.getByRole("textbox", { name: /Intent/ }).fill("fill gaps,\nthen scale");
  await name.press("Enter");
  const grouped = await expectPuts(puts, ++n);
  expect(shapeOf(grouped)).toEqual(["s1", "s2+s3", "s4"]);
  expect(grouped.groups[1]).toMatchObject({ name: "Prepare age", intent: "fill gaps,\nthen scale", origin: "manual" });
  await expect(bar(page).locator("[data-row-first-step='s2'] .pipeline-group-head")).toBeFocused();
  await expect(bar(page).getByLabel(/Select step/)).toHaveCount(0); // select mode is over
  await expect.poll(() => shapeOf(onDisk("g249c"))).toEqual(["s1", "s2+s3", "s4"]);
  expect(onDisk("g249c").groups[1]).toMatchObject({ name: "Prepare age", origin: "manual" });
  console.log(`[249c] group PUT groups=${JSON.stringify(grouped.groups)}`);

  // The origin marker does not eat the name.
  const title = bar(page).locator(".pipeline-group-head .pipeline-title");
  await expect(title).toHaveText("Prepare age");
  expect(await title.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await expect(bar(page).locator(".pipeline-group-origin")).toHaveText("manual");

  // Rename (name + intent).
  await bar(page).getByRole("button", { name: "Rename group Prepare age" }).click();
  const rename = page.getByRole("form", { name: "Rename group" });
  await expect(rename.getByRole("textbox", { name: "Group name" })).toHaveValue("Prepare age");
  await rename.getByRole("textbox", { name: "Group name" }).fill("Age prep");
  await rename.getByRole("button", { name: "Save" }).click();
  const renamed = await expectPuts(puts, ++n);
  expect(renamed.groups[1]).toMatchObject({ id: grouped.groups[1]!.id, name: "Age prep", intent: "fill gaps,\nthen scale" });
  console.log(`[249c] rename PUT group=${JSON.stringify(renamed.groups[1])}`);
  await expect(bar(page).locator("[data-row-first-step='s2'] .pipeline-group-head")).toBeFocused();

  // Undo the rename, then ungroup, then undo that.
  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  const undone = await expectPuts(puts, ++n);
  expect(undone.groups[1]!.name).toBe("Prepare age");
  await bar(page).getByRole("button", { name: "Ungroup Prepare age" }).click();
  const ungrouped = await expectPuts(puts, ++n);
  expect(shapeOf(ungrouped)).toEqual(["s1", "s2", "s3", "s4"]);
  expect(ungrouped.groups.map((g) => g.id)).toEqual(["g1", "g2-2", "g3-2", "g4"]); // g2 / g3 were the singletons grouped just before (#275)
  console.log(`[249c] ungroup PUT groups=${JSON.stringify(ungrouped.groups.map((g) => ({ id: g.id, name: g.name, origin: g.origin })))}`);
  await expect.poll(() => shapeOf(onDisk("g249c"))).toEqual(["s1", "s2", "s3", "s4"]);
  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  const regrouped = await expectPuts(puts, ++n);
  expect(shapeOf(regrouped)).toEqual(["s1", "s2+s3", "s4"]);

  // One more undo: the grouping itself, back to four singletons.
  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  const back = await expectPuts(puts, ++n);
  expect(shapeOf(back)).toEqual(["s1", "s2", "s3", "s4"]);

  // Reload shows what is on disk.
  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await waitForGridReady(page);
  await expect(bar(page).locator(".pipeline-group")).toHaveCount(0);
});

test("issue 249c: an agent proposal lands in ONE auto group (real bridge); a failing group says it stays open", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const puts = await setup(page, request, "g249cagent");
  const sid = await page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);
  const identity = (await page.getByLabel("Data grid").getAttribute("data-identity-current"))!;
  const res = await request.post(`${API}/ui/commands`, {
    headers: AUTH,
    data: {
      type: "propose_steps",
      workspace: "g249cagent",
      base_identity: identity,
      session: sid,
      timeout: 30,
      group: { name: "Scale the income columns", intent: "same range before modelling" },
      ops: [
        { add: { step: { op: "scale", target: "both", params: { columns: ["income"] } } } },
        { add: { step: { op: "impute", target: "both", params: { columns: ["income"], strategy: "median" } } } },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  expect((await res.json()).ok).toBe(true);
  const sent = await expectPuts(puts, 1);
  expect(shapeOf(sent).slice(0, 4)).toEqual(["s1", "s2", "s3", "s4"]);
  const agent = sent.groups.at(-1)!;
  expect(agent.step_ids).toHaveLength(2);
  expect(agent).toMatchObject({
    name: "Scale the income columns",
    intent: "same range before modelling",
    origin: "auto",
    produced_by: "agent",
  });
  console.log(`[249c] agent PUT group=${JSON.stringify(agent)}`);
  await expect.poll(() => onDisk("g249cagent").groups.at(-1)?.produced_by).toBe("agent");
  await expect(bar(page).locator(".pipeline-group-head")).toContainText("Scale the income columns");
  await expect(bar(page).locator(".pipeline-group-origin")).toHaveText("agent");

  // Undo: the whole proposal goes in one PUT.
  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  const undone = await expectPuts(puts, 2);
  expect(undone.steps).toHaveLength(4);
  await expect.poll(() => onDisk("g249cagent").groups.length).toBe(4);
});

test("issue 249c: a group holding a failing step stays open and its toggle says so", async ({ page, request }) => {
  test.setTimeout(240_000);
  const failing: Step[] = [
    step("s1", "impute", { columns: ["age"], strategy: "median" }),
    step("s2", "scale", { columns: ["no_such_column"] }),
    step("s3", "scale", { columns: ["age"] }),
  ];
  const res = await request.put(`${API}/workspaces/g249cfail`, {
    data: {
      ...churnWorkspace(),
      name: "g249cfail",
      steps: failing,
      groups: [
        { id: "g1", name: "impute age", intent: "", step_ids: ["s1"], origin: "auto", produced_by: null },
        { id: "gbad", name: "Scale things", intent: "", step_ids: ["s2", "s3"], origin: "manual", produced_by: null },
      ],
    },
  });
  expect(res.status()).toBe(200);
  await page.addInitScript(() => localStorage.setItem("dtk.lastWorkspace", "g249cfail"));
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.getByRole("button", { name: /Workbench/ }).click();
  // The failing step shows once a version before it is viewed (the latest frame itself fails).
  await bar(page).getByRole("button", { name: /^v1 / }).click();
  const toggle = bar(page).getByRole("button", { name: /^Group Scale things stays open/ });
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAttribute("aria-disabled", "true");
  await toggle.click({ force: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(bar(page).getByRole("group", { name: "Steps of Scale things" })).toBeVisible();
  // Documented exception (#275): the view sits at v1, and the nodes after the
  // viewed version (the group header, its step nodes) are dimmed with an inline
  // opacity of 0.5, which fails color-contrast by design. The toggle, the
  // panel and the rest of the page are scanned.
  await expectNoA11yViolations(page, "group with a failing step, forced open (#275)", [
    '[data-group-id="gbad"] .pipeline-group-head',
    "#pipeline-group-gbad .pipeline-node",
  ]);
});
