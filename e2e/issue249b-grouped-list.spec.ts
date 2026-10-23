import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Group, Step, Workspace } from "../src/api/types";
import { validateGroups } from "../src/state/stepGroups";
import { expectNoA11yViolations } from "./a11y";
import { churnWorkspace, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#249 (PR B): the grouped step list. A workspace with a
 * multi-step group is written through the real engine API (PUT, per the
 * contract), then opened in Studio: the group is one collapsed row, expands
 * to its steps, scrubs to its end, is removed in one PUT and undone; a
 * workspace of singleton groups renders exactly as it did before groups.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api`;
const HOME = process.env.DTK_E2E_HOME!;

const step = (id: string, op: string, params: Record<string, unknown>): Step => ({
  id,
  op,
  target: "both",
  params,
});
const steps: Step[] = [
  step("s1", "formula", { name: "age_plus_one", expr: "age + 1" }),
  step("s2", "impute", { columns: ["age"], strategy: "median" }),
  step("s3", "scale", { columns: ["age"] }),
  step("s4", "scale", { columns: ["age_plus_one"] }),
  step("s5", "drop_columns", { columns: ["signup_date"] }),
];
const groups: Group[] = [
  { id: "gprep", name: "Prepare age", intent: "add age+1, fill gaps,\nthen scale", step_ids: ["s1", "s2", "s3"], origin: "manual", produced_by: null },
  { id: "g4", name: "scale age_plus_one", intent: "", step_ids: ["s4"], origin: "auto", produced_by: null },
  { id: "g5", name: "drop signup_date", intent: "", step_ids: ["s5"], origin: "auto", produced_by: null },
];

const localState = (page: Page) =>
  page.evaluate(() => {
    const w = window.__DTK_STATE__!().workspace!;
    return { steps: w.steps, groups: w.groups, viewVersion: window.__DTK_STATE__!().viewVersion };
  });
const onDisk = (name: string): Workspace =>
  JSON.parse(readFileSync(join(HOME, "workspaces", `${name}.json`), "utf-8")) as Workspace;

/** Bodies of the PUTs of workspace `name` seen by the page, from now on. */
function recordPuts(page: Page, name: string): { bodies: Workspace[]; failures: string[] } {
  const rec = { bodies: [] as Workspace[], failures: [] as string[] };
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith(`/api/workspaces/${name}`)) {
      rec.bodies.push(JSON.parse(r.postData() ?? "{}") as Workspace);
    }
  });
  page.on("response", (r) => {
    if (r.request().method() === "PUT" && r.status() >= 400) rec.failures.push(`${r.status()} ${r.url()}`);
  });
  return rec;
}

async function openStored(page: Page, name: string, ready = true): Promise<void> {
  await page.addInitScript((n) => localStorage.setItem("dtk.lastWorkspace", n), name);
  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.getByRole("button", { name: /Workbench/ }).click();
  if (ready) await waitForGridReady(page);
}

async function putGrouped(request: APIRequestContext): Promise<void> {
  const res = await request.put(`${API}/workspaces/grouped`, { data: { ...churnWorkspace(), name: "grouped", steps, groups } });
  expect(res.status()).toBe(200);
}

const bar = (page: Page) => page.getByRole("region", { name: "Pipeline" });

test("issue 249b: a multi-step group is one collapsed row, expands, scrubs, is removed in one PUT and undone", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await putGrouped(request);
  const puts = recordPuts(page, "grouped");
  await openStored(page, "grouped");

  // Collapsed by default: raw + group header + 2 singleton rows; steps of the group are hidden.
  const group = bar(page).locator(".pipeline-group");
  const toggle = bar(page).getByRole("button", { name: "Expand group Prepare age" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(bar(page).locator(".pipeline-node-wrap").filter({ hasNot: page.locator(".pipeline-group-head") })).toHaveCount(3); // raw + 2 singletons
  await expect(group).toHaveCount(1);
  await expect(bar(page).locator(".pipeline-group-steps")).toHaveCount(0);
  await expect(group.locator(".pipeline-group-head")).toContainText("Prepare age");
  await expect(group.locator(".pipeline-group-head")).toContainText("3 steps");
  await expect(group.locator(".pipeline-group-head")).toContainText("manual"); // origin marker
  await expect(group.locator(".pipeline-group-head")).toHaveAttribute("title", /Prepare age\nadd age\+1, fill gaps,\nthen scale/);
  if (process.env.DTK_SHOTS) await bar(page).screenshot({ path: join(process.env.DTK_SHOTS, "collapsed.png") });
  await expectNoA11yViolations(page, "grouped step list, collapsed (#249)");

  // Keyboard: Enter opens, the steps show in order, Space closes.
  await toggle.focus();
  await page.keyboard.press("Enter");
  const toggleOpen = bar(page).getByRole("button", { name: "Collapse group Prepare age" });
  await expect(toggleOpen).toHaveAttribute("aria-expanded", "true");
  const inner = bar(page).getByRole("group", { name: "Steps of Prepare age" }).locator(".pipeline-node");
  await expect(inner).toHaveCount(3);
  await expect(inner.nth(0)).toContainText("v1");
  await expect(inner.nth(2)).toContainText("v3");
  await expectNoA11yViolations(page, "grouped step list, expanded (#249)");

  // Scrub inside the group: a partial group.
  await inner.nth(0).click();
  expect((await localState(page)).viewVersion).toBe(1);
  await expect(group.locator(".pipeline-group-head")).toContainText("1 of 3 steps applied");
  if (process.env.DTK_SHOTS) await bar(page).screenshot({ path: join(process.env.DTK_SHOTS, "expanded-partial.png") });
  // Select the group: the version is its last step.
  await group.locator(".pipeline-group-head").click();
  expect((await localState(page)).viewVersion).toBe(3);
  await expect(group.locator(".pipeline-group-head")).toContainText("3 steps");
  // Per-step edit still opens the editor on the step inside the group.
  await inner.nth(1).locator("xpath=..").getByRole("button", { name: "Edit this step" }).click();
  await expect(page.locator(".preview-banner")).toBeVisible({ timeout: 30_000 });
  await page.locator(".preview-banner").getByRole("button", { name: "Discard" }).click();
  await toggleOpen.focus();
  await page.keyboard.press("Space");
  await expect(bar(page).getByRole("button", { name: "Expand group Prepare age" })).toHaveAttribute("aria-expanded", "false");

  // Delete the whole group: confirmation, ONE PUT, valid groups, the dependent step fails.
  const putsBefore = puts.bodies.length;
  await bar(page).getByRole("button", { name: "Remove group Prepare age and replay" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Remove group" });
  await expect(confirmDialog).toContainText("Prepare age");
  await confirmDialog.getByRole("button", { name: "Remove group", exact: true }).click();
  await expect(group).toHaveCount(0);
  await expect.poll(() => puts.bodies.length, { timeout: 15_000 }).toBe(putsBefore + 1);
  const removed = puts.bodies.at(-1)!;
  expect(removed.steps.map((s) => s.id)).toEqual(["s4", "s5"]);
  expect(removed.groups.map((g) => g.id)).toEqual(["g4", "g5"]);
  expect(validateGroups(removed.steps, removed.groups)).toBeNull();
  await expect(page.getByRole("alert").filter({ hasText: /failed.*age_plus_one/ })).toBeVisible(); // s4 needs age_plus_one
  await expect.poll(() => onDisk("grouped").steps.length, { timeout: 15_000 }).toBe(2);

  // Undo: the whole group is back, in one PUT, collapsed again.
  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  await expect(group).toHaveCount(1);
  await expect.poll(() => puts.bodies.length, { timeout: 15_000 }).toBe(putsBefore + 2);
  const restored = puts.bodies.at(-1)!;
  expect(restored.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  expect(restored.groups.map((g) => g.step_ids.join("+"))).toEqual(["s1+s2+s3", "s4", "s5"]);
  expect(validateGroups(restored.steps, restored.groups)).toBeNull();
  await expect(page.getByRole("alert").filter({ hasText: /failed.*age_plus_one/ })).toHaveCount(0);

  // Reload: the file is valid and the group is back, collapsed.
  await expect.poll(() => onDisk("grouped").steps.length, { timeout: 15_000 }).toBe(5);
  const file = onDisk("grouped");
  expect(validateGroups(file.steps, file.groups)).toBeNull();
  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await waitForGridReady(page);
  await expect(bar(page).getByRole("button", { name: "Expand group Prepare age" })).toHaveAttribute("aria-expanded", "false");
  expect(puts.failures).toEqual([]);
  console.log(`[249b] delete-group PUT steps=${JSON.stringify(removed.steps.map((s) => s.id))} groups=${JSON.stringify(removed.groups.map((g) => ({ id: g.id, step_ids: g.step_ids })))}`);
  console.log(`[249b] undo PUT steps=${JSON.stringify(restored.steps.map((s) => s.id))} groups=${JSON.stringify(restored.groups.map((g) => ({ id: g.id, step_ids: g.step_ids, name: g.name })))}`);
});

test("issue 249b: parkison (63 singleton groups) renders as the step list did before groups", async ({ page }) => {
  test.setTimeout(240_000);
  const source = join(homedir(), ".datatoolkit");
  const original = join(source, "workspaces", "parkison.json");
  test.skip(!existsSync(original), "no ~/.datatoolkit/workspaces/parkison.json on this machine");
  const uploads = join(HOME, "uploads");
  const copied = readFileSync(original, "utf-8").replace(
    new RegExp(`${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/uploads/([^"/]+)/([^"]+)`, "g"),
    (_m, dir: string, file: string) => {
      mkdirSync(join(uploads, dir), { recursive: true });
      copyFileSync(join(source, "uploads", dir, file), join(uploads, dir, file));
      return join(uploads, dir, file);
    },
  );
  mkdirSync(join(HOME, "workspaces"), { recursive: true });
  writeFileSync(join(HOME, "workspaces", "parkison.json"), copied, "utf-8");
  await openStored(page, "parkison", false);
  await expect.poll(async () => (await localState(page)).steps.length, { timeout: 30_000 }).toBe(63);

  // The structure the bar had before groups: raw + 63 step nodes, each with a
  // note, edit and remove button; no group chrome, nothing collapsible.
  const nodes = bar(page).locator(".pipeline-nodes");
  await expect(nodes.locator(".pipeline-node-wrap")).toHaveCount(64);
  await expect(nodes.locator(".pipeline-node")).toHaveCount(64);
  await expect(nodes.getByRole("button", { name: "Edit this step" })).toHaveCount(63);
  await expect(nodes.getByRole("button", { name: "Remove this step and replay" })).toHaveCount(63);
  await expect(nodes.locator(".pipeline-group, .pipeline-group-head, .pipeline-group-steps, [aria-expanded]")).toHaveCount(0);
  const structure = await nodes.evaluate((el) =>
    Array.from(el.querySelectorAll("button")).map((b) => b.getAttribute("class")?.split(" ")[0] ?? ""),
  );
  const counts = structure.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});
  console.log(`[249b] parkison bar buttons by class: ${JSON.stringify(counts)}`);
  await expectNoA11yViolations(page, "parkison singleton step list (#249)");
});
