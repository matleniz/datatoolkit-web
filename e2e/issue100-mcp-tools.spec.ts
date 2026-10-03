/**
 * datatoolkit-issues#100 — every Studio command as an MCP tool, end to end:
 * stub pack -> dtk MCP server (policy, audit) -> engine /api/ui/commands ->
 * this Studio tab -> ack back to the tool.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { openWorkbench } from "./helpers";

const ENGINE = process.env.DTK_ENGINE_DIR ?? "";
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/ui`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

const session = (page: Page) =>
  page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);

interface Out {
  results: {
    tool: string;
    is_error: boolean;
    result: { data: Record<string, unknown> };
  }[];
  audit: { tool: string; status: string }[];
}

function runTools(
  script: { tool: string; args: Record<string, unknown> }[],
): Out {
  const stdout = execFileSync(
    join(ENGINE, ".venv/bin/python"),
    [join(process.cwd(), "e2e", "mcp_stub_driver.py")],
    {
      input: JSON.stringify(script),
      env: { ...process.env, DTK_HOME: process.env.DTK_E2E_HOME },
    },
  );
  return JSON.parse(stdout.toString()) as Out;
}

test("#100: each new MCP tool reaches Studio and is acked", async ({
  page,
  request,
}) => {
  test.skip(
    !ENGINE,
    "set DTK_ENGINE_DIR to an engine checkout with a synced .venv (extra agent)",
  );
  test.setTimeout(240_000);
  await openWorkbench(page, true);
  const sid = await session(page);
  await expect
    .poll(
      async () => {
        const r = await request.get(`${API}/context`, {
          headers: AUTH,
          params: { session: sid },
        });
        return r.ok() ? (await r.json()).workspace : null;
      },
      { timeout: 15_000 },
    )
    .toBe("churn");

  const s = { session: sid };
  const script = [
    {
      tool: "set_grid_view",
      args: {
        ...s,
        filter: {
          conditions: [{ column: "age", op: "gt", value: 30 }],
          combine: "and",
        },
        sort: [{ column: "age", desc: true }],
      },
    },
    { tool: "pick_row", args: { ...s, rid: 0 } },
    { tool: "pick_cell", args: { ...s, rid: 1, column: "age" } },
    { tool: "clear_selection", args: { ...s } },
    { tool: "set_target", args: { ...s, column: "sessions" } },
    { tool: "set_dist_by", args: { ...s, by: "plan" } },
    {
      tool: "set_tool_params",
      args: { ...s, tool: "corr", params: { method: "spearman" } },
    },
    {
      tool: "add_variable",
      args: { ...s, name: "mean_age", stat: "mean", column: "age" },
    },
    {
      tool: "draft_chart",
      args: {
        ...s,
        params: { chart: "scatter", x: "age", y: "monthly_spend" },
      },
    },
    {
      tool: "add_chart",
      args: {
        ...s,
        name: "Age vs spend",
        params: { chart: "scatter", x: "age", y: "monthly_spend" },
      },
    },
    {
      tool: "propose_steps",
      args: {
        ...s,
        ops: [
          {
            add: {
              step: {
                op: "scale",
                target: "both",
                params: { columns: ["age"] },
              },
            },
          },
        ],
      },
    },
    { tool: "edit_step", args: { ...s, index: 0 } },
    {
      tool: "fill_editor",
      args: { ...s, params: { columns: ["age", "sessions"] } },
    },
    // Refusals come back from Studio as a framed ack.
    { tool: "pick_cell", args: { ...s, rid: 0, column: "ghost" } },
  ];
  const out = runTools(script);
  const acks = out.results.map((r) => ({
    tool: r.tool,
    is_error: r.is_error,
    ...r.result.data,
  }));
  console.log(JSON.stringify(acks, null, 1));
  for (const ack of acks.slice(0, -1)) {
    expect(ack, ack.tool).toMatchObject({ is_error: false, ok: true });
  }
  expect(acks.at(-1)).toMatchObject({
    ok: false,
    error: 'bad_command: unknown column "ghost"',
  });
  expect(out.audit.map((a) => a.tool)).toEqual(script.map((c) => c.tool));

  const state = await page.evaluate(() => {
    const st = window.__DTK_STATE__!();
    return {
      grid: st.gridView,
      target: st.targetColumn,
      distBy: st.distBy,
      variables: st.workspace?.variables,
      charts: st.workspace?.charts?.map((c) => c.name),
      steps: st.workspace?.steps.map((x) => x.op),
      editor: st.editor && {
        editIndex: st.editor.editIndex,
        op: st.editor.op,
        params: st.editor.params,
      },
      tools: st.dock.tools,
    };
  });
  console.log(JSON.stringify(state, null, 1));
  expect(state.grid.sort).toEqual([{ column: "age", desc: true }]);
  expect(state.target).toBe("sessions");
  expect(state.distBy).toBe("plan");
  expect(state.variables).toContainEqual({
    name: "mean_age",
    stat: "mean",
    column: "age",
  });
  expect(state.charts).toContain("Age vs spend");
  expect(state.steps).toEqual(["scale"]);
  expect(state.editor).toMatchObject({
    editIndex: 0,
    op: "scale",
    params: { columns: ["age", "sessions"] },
  });
  expect(state.tools).toContain("chart");
});
