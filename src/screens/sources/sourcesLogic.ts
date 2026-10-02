import { fmtCount } from "../../bench/format";
import type {
  ChartSpec,
  CsvSource,
  Datasets,
  EngineError,
  ExcelSource,
  FileSourceSpec,
  JsonSource,
  LabelJoin,
  MergeSpec,
  ParquetSource,
  Result,
  Step,
  Workspace,
} from "../../api/types";
import type {
  FileRole,
  RecordPathInfo,
  SheetInfo,
  SourceFileItem,
  WorkspaceSourcesState,
} from "../../state/sourcesState";

export type {
  FileRole,
  RecordPathInfo,
  SheetInfo,
  SourceFileItem,
  WorkspaceSourcesState,
};

/** Engine errors are `{type, message}`; anything else is stringified. */
export function engineMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as Partial<EngineError>;
    const msg = typeof e.message === "string" ? e.message : "";
    const typ = typeof e.type === "string" ? e.type : "";
    if (typ && msg) return `${typ}: ${msg}`;
    if (msg) return msg;
  }
  return String(err);
}

export const ROLE_LABELS: Record<FileRole, string> = {
  trainX: "Train X",
  trainY: "Train y",
  testX: "Test X",
  merge: "Merge",
  ignore: "Ignore",
};

export const ALL_ROLES: FileRole[] = [
  "trainX",
  "trainY",
  "testX",
  "merge",
  "ignore",
];

/** Mirrors the engine join INDEX_NAMES set (case-insensitive). */
const INDEX_NAMES = new Set(["index", "idx", "unnamed: 0", ""]);

/**
 * Heuristics to guess a role from a filename, mirroring prototype behaviour.
 */
export function guessFileRole(
  fileName: string,
  existingRoles: Record<string, FileRole> = {},
): FileRole {
  const lower = fileName.toLowerCase();
  const assignedRoles = Object.values(existingRoles);

  if (
    lower.includes("label") ||
    lower.includes("target") ||
    lower.includes("_y.") ||
    lower.startsWith("y_") ||
    lower.includes("y_train")
  ) {
    return "trainY";
  }
  if (lower.includes("test") || lower.includes("val")) {
    return "testX";
  }
  if (lower.includes("train") || lower.includes("data") || lower.includes("_x.")) {
    return "trainX";
  }
  if (lower.includes("extra") || lower.includes("merge") || lower.includes("cust")) {
    return "merge";
  }

  // Fallbacks if primary slots not taken
  if (!assignedRoles.includes("trainX")) return "trainX";
  if (!assignedRoles.includes("testX") && lower.includes("eval")) return "testX";
  return "ignore";
}

/**
 * Returns column names that are common to both lists (case-sensitive as per SQL/pandas).
 */
export function getCommonColumns(colsA: string[], colsB: string[]): string[] {
  const setB = new Set(colsB);
  return colsA.filter((c) => setB.has(c));
}

function isIndexColumnName(name: string): boolean {
  return INDEX_NAMES.has(name.trim().toLowerCase());
}

/**
 * Value column of a y file, mirroring engine `label_columns` name rules
 * (Index / idx / Unnamed: 0 are not the label).
 */
export function yLabelValueColumn(yCols: string[]): string | null {
  if (yCols.length === 0) return null;
  if (yCols.length === 1) return yCols[0] ?? null;
  if (yCols.length === 2) {
    const indexLike = yCols.filter((c) => isIndexColumnName(c));
    if (indexLike.length === 1) {
      return yCols.find((c) => c !== indexLike[0]) ?? null;
    }
  }
  // Prefer the first non-index-like name when several columns.
  const value = yCols.find((c) => !isIndexColumnName(c));
  return value ?? yCols[0] ?? null;
}

/**
 * Target column name from an engine preview/rows column list: the column
 * present after join that is not from train X (and not a merge key).
 */
export function targetFromPreviewColumns(
  previewColumns: string[],
  trainXCols: string[],
): string | null {
  const xSet = new Set(trainXCols);
  const added = previewColumns.filter((c) => !xSet.has(c));
  if (added.length === 1) return added[0] ?? null;
  if (added.length > 1) {
    const value = added.find((c) => !isIndexColumnName(c));
    return value ?? added[0] ?? null;
  }
  return null;
}

export interface WorkspaceBuildInput {
  name: string;
  files: SourceFileItem[];
  roles: Record<string, FileRole>;
  labelMode: "yfile" | "column";
  yJoin: "order" | "key";
  targetCol?: string | null;
  mergeKey?: string | null;
  mergeInTest?: boolean;
  testDecimal?: string | null;
  steps?: Step[];
  /** Saved charts carried over, like steps (MAT-185). */
  charts?: ChartSpec[];
}

export interface WorkspaceBuildResult {
  workspace: Workspace;
  errors: string[];
  info: {
    y?: string;
    merge?: string;
  };
  targetLabel: string | null;
  originMap: Record<string, "x" | "y" | "merge">;
}

type OriginMap = Record<string, "x" | "y" | "merge">;
type BuildInfo = { y?: string; merge?: string };

/** Partial result of one concern of the workspace build. */
interface BuildPart {
  errors: string[];
  info: BuildInfo;
  originMap: OriginMap;
}

function newPart(): BuildPart {
  return { errors: [], info: {}, originMap: {} };
}

function roleErrors(
  trainXFiles: SourceFileItem[],
  testXFiles: SourceFileItem[],
): string[] {
  const errors: string[] = [];
  if (trainXFiles.length === 0) {
    errors.push("Pick a Train X file.");
  } else if (trainXFiles.length > 1) {
    errors.push("Only one file can be Train X.");
  }
  if (testXFiles.length > 1) {
    errors.push("Only one file can be Test X.");
  }
  return errors;
}

function buildTestXSpec(
  testX: SourceFileItem | undefined,
  testDecimal: string | null | undefined,
): FileSourceSpec | undefined {
  if (!testX) return undefined;
  const spec = structuredClone(testX.spec);
  if (spec.kind === "csv" && testDecimal) {
    (spec as CsvSource).decimal = testDecimal;
  }
  return spec;
}

interface YFileBuild extends BuildPart {
  trainYSpec: FileSourceSpec | null;
  targetLabel: string | null;
  labelJoin: LabelJoin;
}

function buildYFileKeyJoin(
  trainX: SourceFileItem | undefined,
  trainY: SourceFileItem,
  targetCol: string | null | undefined,
  errors: string[],
): LabelJoin {
  const labelJoin: LabelJoin = { mode: "key", key: targetCol ?? undefined };
  const commonWithX = trainX ? getCommonColumns(trainX.cols, trainY.cols) : [];
  if (commonWithX.length === 0) {
    errors.push(
      `${trainY.name} has no column in common with train X for key join.`,
    );
  } else if (!targetCol || !commonWithX.includes(targetCol)) {
    labelJoin.key = commonWithX[0];
  }
  return labelJoin;
}

function checkOrderJoin(
  trainX: SourceFileItem | undefined,
  trainY: SourceFileItem,
  part: BuildPart,
): void {
  if (
    trainX &&
    trainX.rowCount !== undefined &&
    trainY.rowCount !== undefined &&
    trainX.rowCount !== trainY.rowCount
  ) {
    part.errors.push(
      `Label join by order refuses: ${trainY.name} has ${trainY.rowCount} rows, train X has ${trainX.rowCount}.`,
    );
  } else if (trainY.rowCount !== undefined) {
    part.info.y = `${trainY.rowCount} labels joined row by row · 0 rows lost`;
  }
}

function buildYFile(
  input: WorkspaceBuildInput,
  trainX: SourceFileItem | undefined,
  trainY: SourceFileItem | undefined,
): YFileBuild {
  const part = newPart();
  const out: YFileBuild = {
    ...part,
    trainYSpec: null,
    targetLabel: null,
    labelJoin: { mode: "order" },
  };
  if (!trainY) {
    out.errors.push(
      "Give a file the role “Train y”, or pick a column of train X as the target.",
    );
    return out;
  }
  out.trainYSpec = structuredClone(trainY.spec);
  const valueCol = yLabelValueColumn(trainY.cols);
  if (valueCol) {
    out.originMap[valueCol] = "y";
    out.targetLabel = valueCol;
  }
  if (input.yJoin === "key") {
    out.labelJoin = buildYFileKeyJoin(
      trainX,
      trainY,
      input.targetCol,
      out.errors,
    );
  } else {
    checkOrderJoin(trainX, trainY, out);
  }
  return out;
}

function buildColumnTarget(
  input: WorkspaceBuildInput,
  trainX: SourceFileItem | undefined,
): { targetColumn: string | null; info: BuildInfo } {
  if (input.targetCol && trainX && trainX.cols.includes(input.targetCol)) {
    return {
      targetColumn: input.targetCol,
      info: { y: `target = column “${input.targetCol}” of train X` },
    };
  }
  return { targetColumn: null, info: { y: "Pick the target column." } };
}

function mergeInfoText(
  trainX: SourceFileItem,
  testX: SourceFileItem | undefined,
  mergeInTest: boolean | undefined,
): string {
  const trainRows = trainX.rowCount ?? "n";
  let text = `train: ${trainRows} / ${trainRows} rows matched`;
  if (mergeInTest && testX) {
    const testRows = testX.rowCount ?? "n";
    text += ` · test: ${testRows} / ${testRows}`;
  }
  return `${text} · 0 rows lost (left join)`;
}

function buildMerge(
  input: WorkspaceBuildInput,
  trainX: SourceFileItem | undefined,
  testX: SourceFileItem | undefined,
  mergeF: SourceFileItem | undefined,
): BuildPart & { merges: MergeSpec[] } {
  const out = { ...newPart(), merges: [] as MergeSpec[] };
  if (!mergeF) return out;
  if (!trainX) {
    out.errors.push("Train X required to configure merge.");
    return out;
  }
  const common = getCommonColumns(trainX.cols, mergeF.cols);
  const chosenKey = input.mergeKey ?? common[0];
  if (!chosenKey || !common.includes(chosenKey)) {
    out.errors.push(`Merge key must exist in train X and ${mergeF.name}.`);
    return out;
  }
  out.merges.push({
    source: structuredClone(mergeF.spec),
    key: chosenKey,
    apply_to: input.mergeInTest ? "both" : "train",
  });
  // Extra merge columns get origin 'merge'
  for (const c of mergeF.cols) {
    if (c !== chosenKey) out.originMap[c] = "merge";
  }
  out.info.merge = mergeInfoText(trainX, testX, input.mergeInTest);
  return out;
}

/**
 * Pure mapping from user choices on Sources screen to a valid Workspace JSON object.
 */
export function buildWorkspaceJson(
  input: WorkspaceBuildInput,
): WorkspaceBuildResult {
  const byRole = (role: FileRole) =>
    input.files.filter((f) => input.roles[f.id] === role);

  const trainXFiles = byRole("trainX");
  const testXFiles = byRole("testX");
  const trainX = trainXFiles[0];
  const testX = testXFiles[0];
  const trainY = byRole("trainY")[0];
  const mergeF = byRole("merge")[0];

  const originMap: OriginMap = {};
  if (trainX) {
    for (const c of trainX.cols) originMap[c] = "x";
  }

  const errors = roleErrors(trainXFiles, testXFiles);
  const info: BuildInfo = {};
  let targetLabel: string | null = null;
  let trainYSpec: FileSourceSpec | null = null;
  let targetColumn: string | null = null;
  let labelJoin: LabelJoin = { mode: "order" };

  if (input.labelMode === "yfile") {
    const y = buildYFile(input, trainX, trainY);
    errors.push(...y.errors);
    Object.assign(info, y.info);
    Object.assign(originMap, y.originMap);
    ({ trainYSpec, targetLabel, labelJoin } = y);
  } else {
    const col = buildColumnTarget(input, trainX);
    targetColumn = col.targetColumn;
    targetLabel = col.targetColumn;
    Object.assign(info, col.info);
  }

  const merge = buildMerge(input, trainX, testX, mergeF);
  errors.push(...merge.errors);
  Object.assign(info, merge.info);
  Object.assign(originMap, merge.originMap);

  const testXSpec = buildTestXSpec(testX, input.testDecimal);
  const datasets: Datasets = {
    train: {
      x: trainX ? structuredClone(trainX.spec) : { kind: "csv", path: "" },
      ...(trainYSpec ? { y: trainYSpec } : {}),
      ...(targetColumn ? { target_column: targetColumn } : {}),
    },
    ...(testXSpec ? { test: { x: testXSpec } } : {}),
  };

  const workspace: Workspace = {
    name: input.name,
    datasets,
    label: labelJoin,
    merges: merge.merges,
    variables: [],
    steps: input.steps ?? [],
    charts: input.charts ?? [],
  };

  return { workspace, errors, info, targetLabel, originMap };
}

const FILE_KINDS = new Set(["csv", "parquet", "excel", "json"]);

export interface FileInspectMapped {
  /** SourceSpec ready to pass to source_columns / workspace load. Null on error. */
  spec: FileSourceSpec | null;
  /** 0-based pandas `header` from load_spec (not 1-based header_line). */
  header: number | null;
  /** Human-readable detected line for the Files table. */
  detected: string;
  /** Set when load_spec is missing or not a usable file source kind. */
  error?: string;
  sheets?: SheetInfo[];
  recordPaths?: RecordPathInfo[];
}

function parseSheetsTable(result: Result): SheetInfo[] | undefined {
  const table = result.tables?.find((t) => t.title === "sheets");
  if (!table?.records?.length) return undefined;
  const out: SheetInfo[] = [];
  for (const rec of table.records) {
    if (typeof rec.sheet !== "string" && typeof rec.sheet !== "number") continue;
    out.push({
      sheet: String(rec.sheet),
      rows: typeof rec.rows === "number" ? rec.rows : 0,
      cols: typeof rec.cols === "number" ? rec.cols : 0,
      suggested_header:
        typeof rec.suggested_header === "number" ? rec.suggested_header : 0,
    });
  }
  return out.length > 0 ? out : undefined;
}

function parseRecordPathsTable(result: Result): RecordPathInfo[] | undefined {
  const table = result.tables?.find((t) => t.title === "record_paths");
  if (!table?.records?.length) return undefined;
  const out: RecordPathInfo[] = [];
  for (const rec of table.records) {
    if (typeof rec.record_path !== "string") continue;
    out.push({
      record_path: rec.record_path,
      records: typeof rec.records === "number" ? rec.records : 0,
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Map a file_inspect Result to load_spec + detected summary.
 * Requires `metrics.load_spec` with a file source `kind` — never falls back
 * silently to csv. Shape must be supplied separately (engine does not put
 * row counts in file_inspect metrics).
 */
export function mapFileInspect(
  result: Result,
  shape?: [number, number] | null,
): FileInspectMapped {
  const metrics = result.metrics ?? {};
  const sheets = parseSheetsTable(result);
  const recordPaths = parseRecordPathsTable(result);

  const raw = metrics.load_spec;
  if (typeof raw !== "string" || !raw) {
    return {
      spec: null,
      header: null,
      detected: "",
      error:
        "file_inspect did not return load_spec; cannot determine the source kind.",
      sheets,
      recordPaths,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      spec: null,
      header: null,
      detected: "",
      error: "file_inspect load_spec is not valid JSON.",
      sheets,
      recordPaths,
    };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("kind" in parsed) ||
    typeof (parsed as { kind: unknown }).kind !== "string" ||
    !FILE_KINDS.has((parsed as { kind: string }).kind)
  ) {
    return {
      spec: null,
      header: null,
      detected: "",
      error: `file_inspect load_spec has unsupported kind ${JSON.stringify(
        (parsed as { kind?: unknown })?.kind,
      )}.`,
      sheets,
      recordPaths,
    };
  }

  let spec = parsed as FileSourceSpec;

  // Excel sheets table may carry suggested_header (0-based) when load_spec
  // omitted header.
  if (spec.kind === "excel" && sheets?.[0]) {
    const first = sheets[0];
    if (spec.header === undefined) {
      spec = { ...spec, header: first.suggested_header };
    }
  }

  let header: number | null = null;
  if (spec.kind === "csv" || spec.kind === "excel") {
    const h = (spec as CsvSource | ExcelSource).header;
    header = h === undefined ? null : h;
  }

  const detected = formatDetectedFromSpec(spec, shape ?? null, metrics);
  return { spec, header, detected, sheets, recordPaths };
}

/**
 * Human-readable detected line from a FileSourceSpec (+ optional shape).
 */
export function formatDetectedFromSpec(
  spec: FileSourceSpec,
  shape?: [number, number] | null,
  metrics?: Record<string, unknown>,
): string {
  const parts: string[] = [spec.kind];

  if (spec.kind === "csv") {
    const csv = spec as CsvSource;
    const sep = csv.sep ?? (metrics ? String(metrics.delimiter ?? ",") : ",");
    const delimRaw = String(sep);
    const delim = delimRaw.replace(/^'|'$/g, "").replace(/'/g, '"') || ",";
    parts.push(`sep ${delim.startsWith('"') ? delim : JSON.stringify(delim)}`);
    parts.push(csv.encoding ?? String(metrics?.encoding_guess ?? "utf-8"));
    parts.push(`header ${csv.header ?? 0}`);
    if (csv.decimal === "," || metrics?.decimal_guess === ",") {
      parts.push('decimal ","');
    }
  } else if (spec.kind === "excel") {
    const excel = spec as ExcelSource;
    parts.push(`sheet ${JSON.stringify(String(excel.sheet ?? 0))}`);
    parts.push(`header ${excel.header ?? 0}`);
  } else if (spec.kind === "json") {
    const json = spec as JsonSource;
    if (json.lines) parts.push("lines");
    if (json.record_path) {
      parts.push(`record_path ${JSON.stringify(json.record_path)}`);
    }
  } else if (spec.kind === "parquet") {
    const pq = spec as ParquetSource;
    if (pq.columns?.length) {
      parts.push(`columns ${pq.columns.length}`);
    }
  }

  if (shape && shape[0] !== undefined && shape[1] !== undefined) {
    parts.push(`${fmtCount(shape[0])} × ${fmtCount(shape[1])}`);
  }

  return parts.join(" · ");
}

/**
 * Reconstruct files and role configuration from an existing Workspace object.
 */
export function extractFilesFromWorkspace(ws: Workspace): {
  files: SourceFileItem[];
  roles: Record<string, FileRole>;
  labelMode: "yfile" | "column";
  yJoin: "order" | "key";
  targetCol: string | null;
  mergeKey: string | null;
  mergeInTest: boolean;
} {
  const files: SourceFileItem[] = [];
  const roles: Record<string, FileRole> = {};
  let labelMode: "yfile" | "column" = "yfile";
  const yJoin: "order" | "key" = ws.label?.mode ?? "order";
  let targetCol: string | null = null;
  let mergeKey: string | null = null;
  let mergeInTest = true;

  if (ws.datasets.train?.x && ws.datasets.train.x.path) {
    const x = ws.datasets.train.x;
    const name = x.path.split("/").pop() || "train_x.csv";
    files.push({
      id: "train_x",
      name,
      path: x.path,
      cols: [],
      spec: x,
    });
    roles["train_x"] = "trainX";
  }

  if (ws.datasets.train?.y && ws.datasets.train.y.path) {
    const y = ws.datasets.train.y;
    const name = y.path.split("/").pop() || "train_y.csv";
    files.push({
      id: "train_y",
      name,
      path: y.path,
      cols: [],
      spec: y,
    });
    roles["train_y"] = "trainY";
    labelMode = "yfile";
  } else if (ws.datasets.train?.target_column) {
    labelMode = "column";
    targetCol = ws.datasets.train.target_column;
  }

  if (ws.datasets.test?.x && ws.datasets.test.x.path) {
    const tx = ws.datasets.test.x;
    const name = tx.path.split("/").pop() || "test_x.csv";
    files.push({
      id: "test_x",
      name,
      path: tx.path,
      cols: [],
      spec: tx,
    });
    roles["test_x"] = "testX";
  }

  if (ws.merges && ws.merges.length > 0) {
    const m = ws.merges[0];
    if (m) {
      const name = m.source.path.split("/").pop() || "merge.csv";
      files.push({
        id: "merge_0",
        name,
        path: m.source.path,
        cols: [],
        spec: m.source,
      });
      roles["merge_0"] = "merge";
      mergeKey = m.key;
      mergeInTest = m.apply_to !== "train";
    }
  }

  return {
    files,
    roles,
    labelMode,
    yJoin,
    targetCol,
    mergeKey,
    mergeInTest,
  };
}

export function emptyWorkspaceSources(): WorkspaceSourcesState {
  return {
    files: [],
    roles: {},
    guessedMap: {},
    labelMode: "yfile",
    yJoin: "order",
    targetCol: null,
    mergeKey: null,
    mergeInTest: true,
  };
}

export function defaultChurnSources(fixtureBase: string): WorkspaceSourcesState {
  const files: SourceFileItem[] = [
    {
      id: "train",
      name: "churn_train.csv",
      path: `${fixtureBase}/churn_train.csv`,
      cols: [
        "customer_id",
        "signup_date",
        "age",
        "city",
        "plan",
        "monthly_spend",
        "sessions",
        "support_calls",
      ],
      detected: 'csv · sep "," · utf-8 · header 0 · 20 × 8',
      spec: { kind: "csv", path: `${fixtureBase}/churn_train.csv` },
      rowCount: 20,
      isGuessed: true,
    },
    {
      id: "labels",
      name: "churn_labels.csv",
      path: `${fixtureBase}/churn_labels.csv`,
      cols: ["churn"],
      detected: 'csv · sep "," · utf-8 · header 0 · 20 × 1',
      spec: { kind: "csv", path: `${fixtureBase}/churn_labels.csv` },
      rowCount: 20,
      isGuessed: true,
    },
    {
      id: "test",
      name: "churn_test.csv",
      path: `${fixtureBase}/churn_test.csv`,
      cols: [
        "customer_id",
        "signup_date",
        "age",
        "city",
        "plan",
        "monthly_spend",
        "sessions",
        "nb_support_calls",
        "promo_code",
      ],
      detected: 'csv · sep "," · utf-8 · header 0 · 6 × 9 · decimal "," seen',
      spec: {
        kind: "csv",
        path: `${fixtureBase}/churn_test.csv`,
        decimal: ",",
      },
      rowCount: 6,
      isGuessed: true,
    },
    {
      id: "extra",
      name: "customers_extra.csv",
      path: `${fixtureBase}/customers_extra.csv`,
      cols: ["customer_id", "region"],
      detected: 'csv · sep "," · utf-8 · header 0 · 26 × 2',
      spec: { kind: "csv", path: `${fixtureBase}/customers_extra.csv` },
      rowCount: 26,
      isGuessed: true,
    },
  ];
  const roles: Record<string, FileRole> = {};
  const guessedMap: Record<string, boolean> = {};
  for (const f of files) {
    roles[f.id] = guessFileRole(f.name, roles);
    guessedMap[f.id] = true;
  }
  return {
    files,
    roles,
    guessedMap,
    labelMode: "yfile",
    yJoin: "order",
    targetCol: null,
    mergeKey: "customer_id",
    mergeInTest: true,
  };
}

/** Columns shown on the Sources Result card (train X + y + merge extras). */
export function resultSchemaColumns(input: {
  previewColumns: string[] | null;
  trainXCols: string[];
  yCols: string[];
  labelMode: "yfile" | "column";
  mergeCols: string[];
  mergeKey: string | null;
}): string[] {
  const mergeExtras = input.mergeKey
    ? input.mergeCols.filter((c) => c !== input.mergeKey)
    : [];
  const yExtras =
    input.labelMode === "yfile"
      ? (() => {
          const v = yLabelValueColumn(input.yCols);
          return v && !input.trainXCols.includes(v) ? [v] : [];
        })()
      : [];

  if (input.previewColumns && input.previewColumns.length > 0) {
    // Prefer live preview order, but ensure merge extras appear as soon as a
    // merge key is chosen (preview can lag or omit them briefly).
    const seen = new Set(input.previewColumns);
    const missing = mergeExtras.filter((c) => !seen.has(c));
    return missing.length
      ? [...input.previewColumns, ...missing]
      : input.previewColumns.slice();
  }

  return [...input.trainXCols, ...yExtras, ...mergeExtras];
}
