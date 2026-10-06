/**
 * datatoolkit-issues#103 — contract test of Studio's agent command parser
 * against the engine's published command table (`GET /api/ui/commands/schema`).
 * A new `parseCommand` case or enum value fails here until the engine table
 * (src/dtk_engine/agent/commands.py) has it too. The parser runs in the page
 * (Vite serves the real module); the schema check is a minimal validator for
 * the JSON Schema subset the engine emits, so there is no dependency to add.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/ui`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

type Schema = Record<string, unknown>;
interface Table {
  [type: string]: { input_schema: Schema; destructive: boolean };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function typeOk(t: string, v: unknown): boolean {
  switch (t) {
    case "string":
      return typeof v === "string";
    case "integer":
      return Number.isInteger(v);
    case "number":
      return typeof v === "number";
    case "boolean":
      return typeof v === "boolean";
    case "null":
      return v === null;
    case "array":
      return Array.isArray(v);
    case "object":
      return isObj(v);
    default:
      throw new Error(`validator: unsupported type ${t}`);
  }
}

const SUPPORTED = new Set([
  "type",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minProperties",
  "pattern",
  "anyOf",
  "description",
]);

function checkString(s: Schema, v: string, path: string): string[] {
  const errs: string[] = [];
  if (typeof s.minLength === "number" && v.length < s.minLength)
    errs.push(`${path}: too short`);
  if (typeof s.maxLength === "number" && v.length > s.maxLength)
    errs.push(`${path}: too long`);
  if (typeof s.pattern === "string" && !new RegExp(s.pattern).test(v)) {
    errs.push(`${path}: pattern mismatch`);
  }
  return errs;
}

function checkNumber(s: Schema, v: number, path: string): string[] {
  const errs: string[] = [];
  if (typeof s.minimum === "number" && v < s.minimum)
    errs.push(`${path}: below minimum`);
  if (typeof s.maximum === "number" && v > s.maximum)
    errs.push(`${path}: above maximum`);
  return errs;
}

function checkArray(s: Schema, v: unknown[], path: string): string[] {
  const errs: string[] = [];
  if (typeof s.minItems === "number" && v.length < s.minItems)
    errs.push(`${path}: too few items`);
  if (isObj(s.items))
    v.forEach((x, i) =>
      errs.push(...validate(s.items as Schema, x, `${path}[${i}]`)),
    );
  return errs;
}

function checkObject(
  s: Schema,
  v: Record<string, unknown>,
  path: string,
): string[] {
  const errs: string[] = [];
  const props = (s.properties ?? {}) as Record<string, Schema>;
  if (
    typeof s.minProperties === "number" &&
    Object.keys(v).length < s.minProperties
  ) {
    errs.push(`${path}: too few properties`);
  }
  for (const r of (s.required ?? []) as string[]) {
    if (!(r in v)) errs.push(`${path}: missing "${r}"`);
  }
  for (const [k, x] of Object.entries(v)) {
    if (props[k]) errs.push(...validate(props[k], x, `${path}.${k}`));
    else if (s.additionalProperties === false)
      errs.push(`${path}: unexpected "${k}"`);
  }
  return errs;
}

/** Errors of `v` against `s` (empty = valid). Subset: see SUPPORTED. */
function validate(s: Schema, v: unknown, path = "$"): string[] {
  for (const k of Object.keys(s)) {
    if (!SUPPORTED.has(k))
      throw new Error(`validator: unsupported keyword "${k}" at ${path}`);
  }
  if (s.type !== undefined) {
    const types = Array.isArray(s.type)
      ? (s.type as string[])
      : [s.type as string];
    if (!types.some((t) => typeOk(t, v)))
      return [`${path}: not of type ${types.join("|")}`];
  }
  const errs: string[] = [];
  if (s.enum && !(s.enum as unknown[]).includes(v))
    errs.push(`${path}: not in enum`);
  if (
    s.anyOf &&
    !(s.anyOf as Schema[]).some((b) => validate(b, v, path).length === 0)
  ) {
    errs.push(`${path}: matches no anyOf branch`);
  }
  if (typeof v === "string") errs.push(...checkString(s, v, path));
  if (typeof v === "number") errs.push(...checkNumber(s, v, path));
  if (Array.isArray(v)) errs.push(...checkArray(s, v, path));
  if (isObj(v)) errs.push(...checkObject(s, v, path));
  return errs;
}

// A valid sample per command (the engine adds `session`; the parser ignores it).
const VALID: Record<string, Record<string, unknown>> = {
  propose_steps: {
    workspace: "churn",
    base_identity: "abc123",
    ops: [
      {
        add: {
          step: { op: "scale", target: "both", params: { columns: ["age"] } },
        },
      },
    ],
  },
  open_window: { tool: "dist", params: { column: "age", by: "plan" } },
  select_columns: { columns: ["age", "sessions"] },
  set_view: { role: "test", version: 1 },
  set_grid_view: {
    filter: {
      conditions: [{ column: "age", op: "gt", value: 30 }],
      combine: "and",
    },
    sort: [{ column: "age", desc: true }],
  },
  pick_row: { rid: 0 },
  pick_cell: { rid: 1, column: "age" },
  clear_selection: {},
  set_target: { column: "sessions" },
  set_dist_by: { by: null },
  set_tool_params: { tool: "corr", params: { method: "spearman" } },
  add_variable: { name: "mean_age", stat: "mean", column: "age" },
  draft_chart: { params: { chart: "scatter", x: "age", y: "monthly_spend" } },
  add_chart: {
    name: "Age vs spend",
    params: { chart: "scatter", x: "age", y: "monthly_spend" },
  },
  edit_step: { index: 0 },
  fill_editor: { op: "scale", params: { columns: ["age"] }, target: "train" },
  set_note: { workspace: "churn", kind: "column", column: "age", text: "years" },
};

// Samples both sides must refuse.
const INVALID: [string, Record<string, unknown>][] = [
  ["pick_row", { rid: -1 }],
  ["pick_row", {}],
  ["pick_cell", { rid: 0, column: "" }],
  ["open_window", { tool: "no_such_window" }],
  ["set_view", { role: "validation" }],
  ["add_variable", { name: "1bad", stat: "mean", column: "age" }],
  ["add_variable", { name: "v", stat: "mode", column: "age" }],
  [
    "add_chart",
    { name: "x".repeat(65), params: { chart: "scatter", x: "a", y: "b" } },
  ],
  ["add_chart", { name: "c", params: { chart: "sankey" } }],
  ["draft_chart", { params: {} }],
  ["edit_step", { index: -1 }],
  ["propose_steps", { ops: [] }],
  ["set_tool_params", { tool: "corr", params: {} }],
  ["set_note", { workspace: "churn", kind: "row", text: "x" }],
  [
    "set_grid_view",
    {
      filter: {
        conditions: [{ column: "a", op: "like", value: 1 }],
        combine: "and",
      },
    },
  ],
];

test("#103: parseCommand agrees with /api/ui/commands/schema", async ({
  page,
  request,
}) => {
  const res = await request.get(`${API}/commands/schema`, { headers: AUTH });
  expect(res.ok()).toBe(true);
  const table = (await res.json()) as Table;

  await page.goto("/");
  const parse = async (raws: Record<string, unknown>[]) =>
    (await page.evaluate(
      `(async () => {
         const m = await import("/src/state/agentCommands.ts");
         return ${JSON.stringify(raws)}.map((r) => m.parseCommand(r));
       })()`,
    )) as { error?: string; type?: string }[];

  // (a) the same command types, from the parser's switch.
  const source = readFileSync(
    join(process.cwd(), "src/state/agentCommands.ts"),
    "utf8",
  );
  const body = source.slice(source.indexOf("export function parseCommand"));
  const cases = [
    ...body.slice(0, body.indexOf("default:")).matchAll(/case "([a-z_]+)":/g),
  ].map((m) => m[1]);
  expect(cases.length).toBeGreaterThan(0);
  expect([...cases].sort()).toEqual(Object.keys(table).sort());
  expect(
    Object.keys(VALID).sort(),
    "add a VALID sample for the new command",
  ).toEqual([...cases].sort());

  // (b) every valid sample passes the parser and its input_schema.
  const types = Object.keys(VALID);
  const parsed = await parse(types.map((t) => ({ type: t, ...VALID[t] })));
  types.forEach((t, i) => {
    expect(parsed[i]?.error, `${t}: parser`).toBeUndefined();
    expect(
      validate(table[t]?.input_schema ?? {}, VALID[t]),
      `${t}: schema`,
    ).toEqual([]);
  });

  // (c) invalid samples are refused by both.
  const bad = await parse(INVALID.map(([t, a]) => ({ type: t, ...a })));
  INVALID.forEach(([t, a], i) => {
    const label = `${t} ${JSON.stringify(a).slice(0, 60)}`;
    expect(bad[i]?.error, `${label}: parser`).toBeTruthy();
    expect(
      validate(table[t]?.input_schema ?? {}, a),
      `${label}: schema`,
    ).not.toEqual([]);
  });

  // (d) enums: Studio's values and the schema's are the same set.
  // Not exported by the module: read the constants from the source.
  const constList = (name: string) => {
    const m = new RegExp(`const ${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(
      source,
    );
    expect(m, `${name} not found`).toBeTruthy();
    return [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1] ?? "");
  };
  const nameMax = Number(/const CHART_NAME_MAX = (\d+);/.exec(source)?.[1]);
  const studio = (await page.evaluate(
    `(async () => {
       const c = await import("/src/state/chartDraft.ts");
       const g = await import("/src/state/gridView.ts");
       const d = await import("/src/state/dockTypes.ts");
       return {
         windows: [...d.TOOL_IDS], chart: [...c.CHART_TYPES], agg: [...c.CHART_AGGS],
         filterOps: g.FILTER_OPS.map((o) => o.op),
       };
     })()`,
  )) as Record<string, string[]>;
  // Walk `properties` by name; "[]" steps into `items`.
  const at = (type: string, ...path: string[]): Schema =>
    path.reduce<Schema>(
      (cur, k) =>
        (k === "[]"
          ? cur.items
          : (cur.properties as Record<string, Schema>)[k]) as Schema,
      table[type]?.input_schema ?? {},
    );
  const stats = constList("VARIABLE_STATS");
  const sorted = (a: unknown) => [...(a as string[])].sort();
  expect(sorted(at("open_window", "tool").enum)).toEqual(
    sorted(studio.windows),
  );
  expect(sorted(at("set_tool_params", "tool").enum)).toEqual(
    sorted(studio.windows),
  );
  expect(sorted(at("add_chart", "params", "chart").enum)).toEqual(
    sorted(studio.chart),
  );
  expect(
    sorted(
      (at("add_chart", "params", "agg").enum as unknown[]).filter(
        (x) => x !== null,
      ),
    ),
  ).toEqual(sorted(studio.agg));
  expect(sorted(at("add_variable", "stat").enum)).toEqual(sorted(stats));
  expect(
    sorted(at("set_grid_view", "filter", "conditions", "[]", "op").enum),
  ).toEqual(sorted(studio.filterOps));
  expect(at("add_chart", "name").maxLength).toBe(nameMax);

  // Each enum value is accepted by the parser (catches a narrowed parser too).
  const enumCases: Record<string, unknown>[] = [
    ...(studio.windows as string[]).map((tool) => ({
      type: "open_window",
      tool,
    })),
    ...(studio.chart as string[]).map((chart) => ({
      type: "draft_chart",
      params: { chart },
    })),
    ...(studio.agg as string[]).map((agg) => ({
      type: "draft_chart",
      params: { agg },
    })),
    ...(stats as string[]).map((stat) => ({
      type: "add_variable",
      name: "v",
      stat,
      column: "age",
    })),
    ...(studio.filterOps as string[]).map((op) => ({
      type: "set_grid_view",
      filter: {
        conditions: [
          {
            column: "age",
            op,
            ...(op === "isna" || op === "notna"
              ? {}
              : { value: op === "isin" || op === "notin" ? [1] : 1 }),
          },
        ],
        combine: "and",
      },
    })),
  ];
  const accepted = await parse(enumCases);
  enumCases.forEach((c, i) =>
    expect(accepted[i]?.error, JSON.stringify(c)).toBeUndefined(),
  );
});
