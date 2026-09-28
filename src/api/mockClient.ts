/**
 * In-memory ApiClient for unit tests, seeded from the prototype churn fixtures.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiClient } from "./client";
import {
  AlignReport,
  ColumnProfiles,
  EngineError,
  ExportManifest,
  ExportRequest,
  JsonSchema,
  KeyInfo,
  PreviewStep,
  Result,
  Role,
  SourceColumn,
  SourceSpec,
  Step,
  TransformInfo,
  UploadResponse,
  Workspace,
  WorkspacePreview,
  WorkspaceRows,
} from "./types";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../e2e/fixtures",
);

/** Minimal RFC4180-ish line split (handles quoted commas like `"41,0"`). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): { columns: string[]; rows: string[][] } {
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length === 0) return { columns: [], rows: [] };
  const columns = splitCsvLine(lines[0] ?? "");
  const rows = lines.slice(1).map(splitCsvLine);
  return { columns, rows };
}

function loadFixture(name: string): { columns: string[]; rows: string[][] } {
  return parseCsv(readFileSync(join(FIXTURES, name), "utf8"));
}

const TRAIN = loadFixture("churn_train.csv");
const LABELS = loadFixture("churn_labels.csv");
const TEST = loadFixture("churn_test.csv");
const EXTRA = loadFixture("customers_extra.csv");

export const CHURN_FIXTURES = {
  train: TRAIN,
  labels: LABELS,
  test: TEST,
  extra: EXTRA,
} as const;

function emptyWorkspace(name: string): Workspace {
  return {
    name,
    datasets: {
      train: {
        x: { kind: "csv", path: join(FIXTURES, "churn_train.csv") },
        y: { kind: "csv", path: join(FIXTURES, "churn_labels.csv") },
      },
      test: {
        x: {
          kind: "csv",
          path: join(FIXTURES, "churn_test.csv"),
          decimal: ",",
        },
      },
    },
    label: { mode: "order" },
    merges: [
      {
        source: { kind: "csv", path: join(FIXTURES, "customers_extra.csv") },
        key: "customer_id",
        apply_to: "both",
      },
    ],
    variables: [],
    steps: [],
  };
}

function columnsOf(
  frame: { columns: string[]; rows: string[][] },
): SourceColumn[] {
  return frame.columns.map((name) => {
    const sample = frame.rows.map((r) => r[frame.columns.indexOf(name)] ?? "");
    const numeric = sample.every(
      (v) => v === "" || /^-?\d+([.,]\d+)?$/.test(v),
    );
    return { name, dtype: numeric ? "float64" : "object", numeric };
  });
}

export class MockApiClient implements ApiClient {
  private workspaces = new Map<string, Workspace>([
    ["churn", emptyWorkspace("churn")],
  ]);
  private uploads = new Map<string, string>();

  listKeys(): Promise<KeyInfo[]> {
    return Promise.resolve([
      {
        id: "dataset_overview",
        title: "Dataset overview",
        category: "analysis",
        description: "Shape, dtypes, missingness",
        needs_target: false,
      },
    ]);
  }

  keySchema(_id: string): Promise<JsonSchema> {
    return Promise.resolve({
      type: "object",
      properties: {
        source: { type: "object", title: "Source" },
      },
      required: ["source"],
    });
  }

  runKey(id: string, params: Record<string, unknown>): Promise<Result> {
    if (id === "file_inspect") {
      const path = String(params.path ?? "");
      const isTest = path.includes("churn_test");
      return Promise.resolve({
        metrics: {
          delimiter: "','",
          encoding_guess: "utf-8",
          header_line: 1,
          decimal_guess: isTest ? "." : ".",
          load_spec: JSON.stringify({
            kind: "csv",
            path,
            sep: ",",
            encoding: "utf-8",
            decimal: isTest ? "." : ".",
            header: 0,
          }),
        },
        tables: [],
        figures: [],
        text: "",
      });
    }
    return Promise.resolve({
      metrics: { rows: TRAIN.rows.length, columns: TRAIN.columns.length },
      tables: [],
      figures: [],
      text: "mock result",
    });
  }

  listTransforms(): Promise<TransformInfo[]> {
    return Promise.resolve([
      {
        op: "drop_columns",
        title: "Drop columns",
        description: "Remove columns",
        needs_target: false,
      },
      {
        op: "rename",
        title: "Rename",
        description: "Rename a column",
        needs_target: false,
      },
    ]);
  }

  transformSchema(op: string): Promise<JsonSchema> {
    if (op === "drop_columns") {
      return Promise.resolve({
        type: "object",
        properties: {
          columns: {
            type: "array",
            items: { type: "string" },
            "x-dtk-widget": "columns",
            "x-dtk-source": "step",
            "x-dtk-dtype": "any",
          },
        },
      });
    }
    return Promise.resolve({ type: "object", properties: {} });
  }

  listWorkspaces(): Promise<Workspace[]> {
    return Promise.resolve(
      [...this.workspaces.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
  }

  getWorkspace(name: string): Promise<Workspace> {
    const ws = this.workspaces.get(name);
    if (!ws) {
      return Promise.reject(
        new EngineError("WorkspaceNotFoundError", `unknown workspace ${name}`),
      );
    }
    return Promise.resolve(structuredClone(ws));
  }

  saveWorkspace(ws: Workspace): Promise<Workspace> {
    const copy = structuredClone(ws);
    this.workspaces.set(ws.name, copy);
    return Promise.resolve(structuredClone(copy));
  }

  deleteWorkspace(name: string): Promise<void> {
    if (!this.workspaces.has(name)) {
      return Promise.reject(
        new EngineError("WorkspaceNotFoundError", `unknown workspace ${name}`),
      );
    }
    this.workspaces.delete(name);
    return Promise.resolve();
  }

  exportWorkspace(name: string, body: ExportRequest): Promise<ExportManifest> {
    if (!this.workspaces.has(name)) {
      return Promise.reject(
        new EngineError("WorkspaceNotFoundError", `unknown workspace ${name}`),
      );
    }
    return Promise.resolve({
      generator: "mock-api",
      manifest_version: 1,
      workspace: name,
      exported_at: new Date().toISOString(),
      versions: { engine: "mock" },
      sources: [],
      label: { mode: "order" },
      steps: [],
      outputs: {
        train: {
          path: `${body.out_dir}/processed/train.parquet`,
          rows: 100,
        },
        test: {
          path: `${body.out_dir}/processed/test.parquet`,
          rows: 40,
        },
      },
    });
  }

  sourceColumns(spec: SourceSpec): Promise<SourceColumn[]> {
    if (spec.kind === "csv") {
      if (spec.path.includes("churn_train")) {
        return Promise.resolve(columnsOf(TRAIN));
      }
      if (spec.path.includes("churn_test")) {
        return Promise.resolve(columnsOf(TEST));
      }
      if (spec.path.includes("churn_labels")) {
        return Promise.resolve(columnsOf(LABELS));
      }
      if (spec.path.includes("customers_extra")) {
        return Promise.resolve(columnsOf(EXTRA));
      }
    }
    return Promise.reject(
      new EngineError("SourceError", `cannot load ${JSON.stringify(spec)}`),
    );
  }

  previewWorkspace(
    _workspace: Workspace,
    role: Role,
    headRows = 5,
  ): Promise<WorkspacePreview> {
    const frame = role === "train" ? TRAIN : TEST;
    const head = frame.rows.slice(0, headRows).map((cells) => {
      const rec: Record<string, string | number | null> = {};
      frame.columns.forEach((c, i) => {
        const v = cells[i] ?? "";
        rec[c] = v === "" ? null : v;
      });
      return rec;
    });
    return Promise.resolve({
      shape: [frame.rows.length, frame.columns.length],
      columns: [...frame.columns],
      head,
    });
  }

  workspaceRows(
    _workspace: Workspace,
    role: Role,
    version: number | null,
    offset: number,
    limit: number,
  ): Promise<WorkspaceRows> {
    const frame = role === "train" ? TRAIN : TEST;
    const slice = frame.rows.slice(offset, offset + limit);
    const rows = slice.map((cells, i) => {
      const rec: Record<string, string | number | null> & { _rid: number } = {
        _rid: offset + i,
      };
      frame.columns.forEach((c, j) => {
        const v = cells[j] ?? "";
        rec[c] = v === "" ? null : v;
      });
      return rec;
    });
    return Promise.resolve({
      columns: frame.columns.map((name) => ({
        name,
        dtype: "object",
        kind: name.endsWith("_id")
          ? ("identifier" as const)
          : ["age", "monthly_spend", "sessions", "support_calls"].includes(name)
            ? ("number" as const)
            : ("text" as const),
      })),
      rows,
      total: frame.rows.length,
      version: version ?? 0,
    });
  }

  columnProfiles(
    _workspace: Workspace,
    role: Role,
    version: number | null = null,
  ): Promise<ColumnProfiles> {
    const frame = role === "train" ? TRAIN : TEST;
    return Promise.resolve({
      version: version ?? 0,
      columns: frame.columns.map((name) => ({
        name,
        kind: name.endsWith("_id")
          ? ("identifier" as const)
          : name === "churn"
            ? ("bool" as const)
            : ["age", "monthly_spend", "sessions", "support_calls"].includes(
                  name,
                )
              ? ("number" as const)
              : ("text" as const),
        count: frame.rows.length,
        missing: frame.rows.filter(
          (r) => (r[frame.columns.indexOf(name)] ?? "") === "",
        ).length,
        sentinel_candidates:
          name === "age"
            ? [{ value: -999, count: 2 }]
            : [],
        distinct: new Set(
          frame.rows.map((r) => r[frame.columns.indexOf(name)] ?? ""),
        ).size,
        histogram: null,
        top_values: [],
        iqr_bounds: null,
        outliers: 0,
        variants: null,
        looks_like_dates: name.includes("date"),
        numbers_as_text: role === "test" && name === "monthly_spend",
        skewed: false,
      })),
    });
  }

  previewStep(
    _workspace: Workspace,
    step: Step,
    role: Role,
  ): Promise<PreviewStep> {
    const frame = role === "train" ? TRAIN : TEST;
    const cols = [...frame.columns];
    return Promise.resolve({
      shape: [frame.rows.length, cols.length],
      columns: cols,
      added_columns: [],
      removed_columns:
        step.op === "drop_columns" && Array.isArray(step.params.columns)
          ? (step.params.columns as string[])
          : [],
      removed_rids: [],
      changed: [],
      changed_total: 0,
      state: {},
      fitted_on: step.target === "test" ? "test" : "train",
    });
  }

  alignReport(_workspace: Workspace): Promise<AlignReport> {
    return Promise.resolve({
      columns: [
        {
          train: {
            name: "support_calls",
            kind: "number",
            samples: [0, 2, 0],
          },
          test: {
            name: "nb_support_calls",
            kind: "number",
            samples: [1, 4, 0],
          },
          status: "type_mismatch",
          numbers_as_text: false,
          train_mean: 1.5,
          test_mean: 1.8,
          similar: ["nb_support_calls"],
        },
        {
          train: {
            name: "monthly_spend",
            kind: "number",
            samples: [42.5, 12.0],
          },
          test: {
            name: "monthly_spend",
            kind: "text",
            samples: ["41,0", "9,5"],
          },
          status: "type_mismatch",
          numbers_as_text: true,
          train_mean: 40,
          test_mean: null,
          similar: [],
        },
        {
          train: null,
          test: {
            name: "promo_code",
            kind: "text",
            samples: ["SPRING", null],
          },
          status: "extra_in_test",
          numbers_as_text: false,
          train_mean: null,
          test_mean: null,
          similar: [],
        },
      ],
    });
  }

  upload(filename: string, _body: BodyInit): Promise<UploadResponse> {
    const path = `/mock/uploads/${filename}`;
    this.uploads.set(filename, path);
    return Promise.resolve({ path });
  }
}
