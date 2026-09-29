/**
 * MAT-175 — refresh matrix.
 *
 * After each action (apply Impute / Scale / One-hot / Drop column / Filter
 * rows, edit a step's params, remove a step, time-travel, switch Train/Test)
 * every consumer must show exactly the viewed version: grid, inspector, each
 * dock window and the Suggestions count. Each consumer is compared against a
 * direct engine call (`run_key` with a `dataset` source pinned to the version,
 * or `/workspace/rows|profiles` at that version) — not eyeballed.
 */
import { expect, test, type Page } from "@playwright/test";

import type {
  ColumnProfiles,
  DatasetSource,
  JsonSchema,
  Result,
  Step,
  Workspace,
  WorkspaceRows,
} from "../src/api/types";
import { TABLE_PAGE_SIZE } from "../src/bench/dock/resultTable";
import { keyParamsFromSchema } from "../src/bench/left/keyParams";
import {
  SUGGESTION_KEYS,
  mapSuggestionCards,
} from "../src/bench/left/suggestions";
import {
  captureFlowScreenshot,
  churnWorkspace,
  clearFlowScreenshots,
  waitForGridReady,
} from "./helpers";

type Role = "train" | "test";
type ToolId =
  | "outliers"
  | "dist"
  | "missing"
  | "corr"
  | "compare"
  | "chart"
  | "target"
  | "drift"
  | "feature_selection";

const FLOW = "mat175-refresh-matrix";
const WS = "churn";
const TARGET = "churn";

/** ≤ 4 windows at once (MAX_DOCK_TOOLS); each group has its own selection. */
const GROUPS: { tools: ToolId[]; selection: string[] }[] = [
  { tools: ["outliers", "dist", "missing"], selection: ["age"] },
  { tools: ["corr", "compare", "chart"], selection: ["age", "sessions"] },
  { tools: ["target", "drift", "feature_selection"], selection: ["age"] },
];

const TOOL_KEY: Record<Exclude<ToolId, "compare">, string> = {
  outliers: "outliers",
  dist: "column_distribution",
  missing: "missing_values",
  corr: "correlations",
  chart: "chart",
  target: "target_analysis",
  drift: "train_test_check",
  feature_selection: "feature_selection",
};

function src(role: Role, version: number, labeled = role === "train"): DatasetSource {
  return { kind: "dataset", workspace: WS, role, labeled, version };
}

function identityPrefix(role: Role, version: number): string {
  return `${WS}|${role}|v${version}|`;
}

async function dispatch(page: Page, action: Record<string, unknown>) {
  await page.evaluate((a) => window.__DTK_DISPATCH__!(a as never), action);
}

async function appState(page: Page) {
  return page.evaluate(() => {
    const s = window.__DTK_STATE__!();
    return {
      workspace: s.workspace as Workspace,
      tools: s.dock.tools as string[],
      sugCount: s.sugCount,
    };
  });
}

async function runKey(
  page: Page,
  key: string,
  params: Record<string, unknown>,
): Promise<Result> {
  const res = await page.request.post(`/api/keys/${key}/run`, {
    data: { params },
  });
  expect(res.ok(), `${key}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as Result;
}

function comparableSteps(steps: Step[]) {
  return steps.map((s) => ({ op: s.op, target: s.target, params: s.params }));
}

/** Engine store must hold the front's workspace before keys are compared. */
async function storedWorkspace(page: Page): Promise<Workspace> {
  const front = (await appState(page)).workspace;
  let stored: Workspace | null = null;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/workspaces/${WS}`);
        stored = (await res.json()) as Workspace;
        return JSON.stringify(comparableSteps(stored.steps));
      },
      { timeout: 30_000 },
    )
    .toBe(JSON.stringify(comparableSteps(front.steps)));
  return stored!;
}

async function selectColumns(page: Page, cols: string[]) {
  await dispatch(page, { type: "CLEAR_SELECTION" });
  for (const [i, c] of cols.entries()) {
    await dispatch(page, { type: "PICK_COL", name: c, add: i > 0 });
  }
}

async function openTools(page: Page, tools: ToolId[]) {
  for (const t of (await appState(page)).tools) {
    await dispatch(page, { type: "TOGGLE_TOOL", id: t });
  }
  for (const t of tools) await dispatch(page, { type: "OPEN_TOOL", id: t });
}

/** Wait until an element's rendered identity is the current one, at `prefix`. */
async function expectSettled(
  page: Page,
  selector: string,
  prefix: string,
  what: string,
) {
  const el = page.locator(selector).first();
  await expect(el, what).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const shown = await el.getAttribute("data-identity");
        const current = await el.getAttribute("data-identity-current");
        return shown === current && !!current?.startsWith(prefix)
          ? "ok"
          : `${what}: shown=${shown} current=${current} want=${prefix}…`;
      },
      { timeout: 60_000 },
    )
    .toBe("ok");
}

function tableTexts(result: Result): { title: string; cells: string[][] }[] {
  return result.tables.map((t) => {
    const heads = Object.keys(t.records[0] ?? {});
    return {
      title: t.title,
      cells: t.records
        .slice(0, TABLE_PAGE_SIZE)
        .map((row) => heads.map((h) => String(row[h] ?? ""))),
    };
  });
}

async function domTables(page: Page, scope: string) {
  return page.locator(`${scope} .result-table-block`).evaluateAll((blocks) =>
    blocks.map((b) => ({
      title: b.querySelector(".result-table-title")?.textContent ?? "",
      cells: [...b.querySelectorAll("tbody tr")].map((tr) =>
        [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
      ),
    })),
  );
}

async function checkGridAndInspector(
  page: Page,
  stored: Workspace,
  role: Role,
  version: number,
) {
  const prefix = identityPrefix(role, version);
  await expectSettled(page, '[aria-label="Data grid"]', prefix, "grid");

  const rowsRes = await page.request.post("/api/workspace/rows", {
    data: { workspace: stored, role, version, offset: 0, limit: 500 },
  });
  const rows = (await rowsRes.json()) as WorkspaceRows;
  const headers = await page
    .locator(".grid-th")
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute("aria-label") ?? "").split(", ")[0]),
    );
  expect(headers, "grid columns").toEqual(rows.columns.map((c) => c.name));
  await expect(page.locator(".grid-row"), "grid rows").toHaveCount(rows.total);

  // Inspector on `age` vs /workspace/profiles at the same version.
  await selectColumns(page, ["age"]);
  await expectSettled(page, 'aside[aria-label="Inspector"]', prefix, "inspector");
  const profRes = await page.request.post("/api/workspace/profiles", {
    data: { workspace: stored, role, version },
  });
  const prof = (await profRes.json()) as ColumnProfiles;
  const age = prof.columns.find((c) => c.name === "age")!;
  const stats = await page
    .locator("aside[aria-label='Inspector'] .insp-stat")
    .evaluateAll((els) =>
      Object.fromEntries(
        els.map((e) => {
          const [k, v] = [...e.querySelectorAll("span")].map(
            (s) => s.textContent ?? "",
          );
          return [k, v];
        }),
      ),
    );
  expect(stats.missing, "inspector missing").toBe(String(age.missing));
  expect(stats.distinct, "inspector distinct").toBe(String(age.distinct));
  expect(stats["non-null"], "inspector non-null").toBe(
    String(age.count - age.missing),
  );
  return prof;
}

async function checkWindow(
  page: Page,
  tool: ToolId,
  role: Role,
  version: number,
  prof: ColumnProfiles,
) {
  const scope = `[data-tool="${tool}"]`;
  const inner =
    tool === "chart" ? `${scope} .chart-dock` : `${scope} .dock-identity-wrap`;
  const prefix = identityPrefix(role, version);
  await expectSettled(page, inner, prefix, tool);
  await expect(page.locator(`${scope}:has-text('Loading…')`)).toHaveCount(0);
  const strip = page.locator(`${scope} [data-identity-strip]`);
  await expect(strip).toHaveAttribute("data-identity-version", String(version));

  if (tool === "compare") {
    for (const col of ["age", "sessions"]) {
      const p = prof.columns.find((c) => c.name === col)!;
      await expect(
        page.locator(`${scope} .matrix-cell[data-col="${col}"][data-stat="missing"]`),
      ).toHaveText(String(p.missing));
      await expect(
        page.locator(`${scope} .matrix-cell[data-col="${col}"][data-stat="distinct"]`),
      ).toHaveText(String(p.distinct));
    }
    return;
  }

  if (role === "test" && (tool === "target" || tool === "feature_selection")) {
    await expect(page.locator(`${scope} .dock-msg`)).toContainText(
      "The test set has no label",
    );
    return;
  }

  // Windows may re-run once their Parameters panel settles defaults: poll
  // until the rendered result matches a direct run_key with the params the
  // window used, whose source must be pinned to the viewed version.
  const srcRole: Role = tool === "drift" ? "train" : role;
  await expect
    .poll(
      async () => {
        const el = page.locator(inner).first();
        if ((await page.locator(`${scope}:has-text('Loading…')`).count()) > 0) {
          return `${tool}: loading`;
        }
        const shown = await el.getAttribute("data-identity");
        const current = await el.getAttribute("data-identity-current");
        if (shown !== current || !current?.startsWith(prefix)) {
          return `${tool}: identity ${shown} vs ${current}`;
        }
        const raw = await el.getAttribute("data-run-params");
        if (!raw) return `${tool}: no run params`;
        const params = JSON.parse(raw) as Record<string, unknown>;
        // train_test_check has `train` (unlabeled) + `test`, no `source`.
        const srcParam = tool === "drift" ? params.train : params.source;
        const want = src(srcRole, version, tool === "drift" ? false : undefined);
        if (JSON.stringify(srcParam) !== JSON.stringify(want)) {
          return `${tool}: source ${JSON.stringify(srcParam)}`;
        }
        if (
          params.test &&
          JSON.stringify(params.test) !==
            JSON.stringify(src("test", version, false))
        ) {
          return `${tool}: test source ${JSON.stringify(params.test)}`;
        }
        const direct = await runKey(page, TOOL_KEY[tool], params);
        if (tool === "chart") {
          const titles = await page
            .locator(`${scope} .result-figure .result-table-title`)
            .allTextContents();
          const want = direct.figures.map((f) => f.title);
          return JSON.stringify(titles) === JSON.stringify(want)
            ? "ok"
            : `chart figures ${JSON.stringify(titles)} vs ${JSON.stringify(want)}`;
        }
        // Tables live in the collapsed Details drawer (MAT-235).
        const details = page.locator(`${scope} .result-details-toggle`);
        if (
          (await details.count()) > 0 &&
          (await details.getAttribute("aria-expanded")) !== "true"
        ) {
          await details.click();
          return `${tool}: opening details`;
        }
        const dom = JSON.stringify(await domTables(page, scope));
        const exp = JSON.stringify(tableTexts(direct));
        return dom === exp ? "ok" : `${tool} tables: ${dom} vs ${exp}`;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe("ok");
}

async function checkSuggestions(page: Page, version: number) {
  // Suggestions always analyse train (+ test) at the viewed version.
  const prefix = identityPrefix("train", version);
  await expectSettled(page, ".sug-identity", prefix, "suggestions");
  await expect(page.locator("[data-sug-rechecking]")).toHaveCount(0);

  const available: Record<string, unknown> = {
    source: src("train", version, true),
    target: TARGET,
    test: src("test", version, false),
  };
  const results: { keyId: string; result: Result }[] = [];
  for (const keyId of SUGGESTION_KEYS) {
    const schemaRes = await page.request.get(`/api/keys/${keyId}/schema`);
    const schema = (await schemaRes.json()) as JsonSchema;
    const params = keyParamsFromSchema(schema, available);
    const res = await page.request.post(`/api/keys/${keyId}/run`, {
      data: { params },
    });
    if (res.ok()) {
      results.push({ keyId, result: (await res.json()) as Result });
    }
  }
  const expected = mapSuggestionCards(results).length;
  await expect
    .poll(async () => (await appState(page)).sugCount, { timeout: 30_000 })
    .toBe(expected);
  await expect(page.locator(".sug-list")).toHaveAttribute(
    "data-sug-cards",
    String(expected),
  );
}

/** Every consumer reflects `role` at `version`, against direct engine calls. */
async function checkAll(page: Page, role: Role, version: number, label: string) {
  await test.step(`${label} → ${role} v${version}`, async () => {
    await waitForGridReady(page);
    const stored = await storedWorkspace(page);
    const prof = await checkGridAndInspector(page, stored, role, version);
    await checkSuggestions(page, version);
    for (const group of GROUPS) {
      await selectColumns(page, group.selection);
      await openTools(page, group.tools);
      for (const tool of group.tools) {
        await checkWindow(page, tool, role, version, prof);
      }
    }
  });
}

async function applyStep(
  page: Page,
  op: string,
  params: Record<string, unknown>,
  target: "train" | "test" | "both" = "both",
) {
  const before = (await appState(page)).workspace.steps.length;
  await dispatch(page, { type: "OPEN_EDITOR", op, params, target });
  const apply = page.getByRole("button", { name: "Apply step" }).first();
  await expect(apply).toBeEnabled({ timeout: 30_000 });
  await apply.click();
  await expect
    .poll(async () => (await appState(page)).workspace.steps.length)
    .toBe(before + 1);
}

test("MAT-175: refresh matrix — every consumer follows the exact version", async ({
  page,
}) => {
  test.setTimeout(900_000);
  clearFlowScreenshots(FLOW);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.__DTK_DISPATCH__ === "function",
  );
  await dispatch(page, { type: "SET_WORKSPACE", workspace: churnWorkspace() });
  await dispatch(page, { type: "SET_SCREEN", screen: "bench" });
  await dispatch(page, { type: "SET_ROLE", role: "train" });
  await dispatch(page, { type: "SET_VIEW_VERSION", version: null });
  await dispatch(page, { type: "SET_LEFT_TAB", tab: "suggestions" });
  await expect(page.getByLabel("Workbench")).toBeVisible();
  await checkAll(page, "train", 0, "sources");

  // Live edit (before Apply): windows say they show the last applied version.
  await openTools(page, ["outliers", "missing"]);
  await selectColumns(page, ["age"]);
  await dispatch(page, {
    type: "OPEN_EDITOR",
    op: "impute",
    params: { columns: ["age"], strategy: "median" },
    target: "both",
  });
  await expect(page.getByLabel("Pending step")).toBeVisible({ timeout: 30_000 });
  for (const tool of ["outliers", "missing"]) {
    const strip = page.locator(`[data-tool="${tool}"] [data-identity-strip]`);
    await expect(strip).toHaveAttribute("data-identity-editing", "1");
    await expect(strip).toHaveAttribute("data-identity-version", "0");
    await expect(strip).toContainText("last applied version");
  }
  await expect(page.locator(".sug-identity")).toHaveAttribute(
    "data-identity-editing",
    "1",
  );
  await captureFlowScreenshot(page, FLOW, "01-live-edit-labelled.png");
  await page.getByRole("button", { name: "Apply step" }).first().click();
  await expect
    .poll(async () => (await appState(page)).workspace.steps.length)
    .toBe(1);
  await expect(
    page.locator('[data-tool="outliers"] [data-identity-strip]'),
  ).toHaveAttribute("data-identity-editing", "0");
  await checkAll(page, "train", 1, "apply Impute");

  await applyStep(page, "scale", { columns: ["monthly_spend"], method: "standard" });
  await checkAll(page, "train", 2, "apply Scale");

  await applyStep(page, "onehot", { columns: ["plan"] });
  await checkAll(page, "train", 3, "apply One-hot");

  await applyStep(page, "drop_columns", { columns: ["signup_date"] });
  await checkAll(page, "train", 4, "apply Drop column");

  await applyStep(page, "filter_rows", {
    conditions: [{ column: "sessions", op: "gt", value: 3 }],
    combine: "and",
  });
  await checkAll(page, "train", 5, "apply Filter rows");

  // Edit a step's params in place (same step count — MAT-175 root cause #2).
  const steps = (await appState(page)).workspace.steps;
  const imputeIdx = steps.findIndex((s) => s.op === "impute");
  const edited = steps.map((s, i) =>
    i === imputeIdx ? { ...s, params: { ...s.params, strategy: "mean" } } : s,
  );
  await dispatch(page, { type: "SET_STEPS", steps: edited });
  await checkAll(page, "train", 5, "edit Impute params");

  // Remove a step (Scale) through the pipeline bar.
  await page
    .locator(".pipeline-node-rel", {
      has: page.locator(".pipeline-title", { hasText: /^Scale/ }),
    })
    .getByRole("button", { name: "Remove this step and replay" })
    .click();
  await expect
    .poll(async () => (await appState(page)).workspace.steps.length)
    .toBe(4);
  await checkAll(page, "train", 4, "remove Scale");

  // Time-travel to v1 (the MAT-175 repro: windows must not show latest).
  await page
    .locator(".pipeline-node", {
      has: page.locator(".pipeline-ver", { hasText: /^v1$/ }),
    })
    .click();
  await checkAll(page, "train", 1, "time-travel v1");
  await captureFlowScreenshot(page, FLOW, "02-time-travel-v1.png");

  // Switch to Test while still on v1, then back to Train at latest.
  await page.getByRole("group", { name: "Dataset shown" }).getByRole("button", { name: "Test" }).click();
  await checkAll(page, "test", 1, "switch Test");
  await captureFlowScreenshot(page, FLOW, "03-test-v1.png");

  await page.getByRole("group", { name: "Dataset shown" }).getByRole("button", { name: "Train" }).click();
  await dispatch(page, { type: "SET_VIEW_VERSION", version: null });
  await checkAll(page, "train", 4, "back to Train latest");
});
