/**
 * Contract payload types for the datatoolkit HTTP API (`dtk-api`).
 * Mirrors ARCHITECTURE.md + FRONT-WEB.md (incl. MAT-127 shapes).
 */

/** JSON-Schema subset used by key/transform param forms. */
export type JsonSchemaType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null";

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  /** dtk column-selector hints (MAT-95) */
  "x-dtk-widget"?: "columns" | "column";
  "x-dtk-source"?: string;
  "x-dtk-dtype"?: "any" | "numeric";
  [key: string]: unknown;
}

/* ---------- SourceSpec (discriminated on kind) ---------- */

export interface CsvSource {
  kind: "csv";
  path: string;
  sep?: string;
  encoding?: string;
  decimal?: string;
  header?: number | null;
  na_values?: string[] | null;
  dtype?: Record<string, string> | null;
  parse_dates?: string[] | null;
  usecols?: string[] | null;
  on_bad_lines?: "error" | "warn" | "skip";
  keep_leading_zeros?: boolean;
}

export interface ParquetSource {
  kind: "parquet";
  path: string;
  columns?: string[] | null;
  filters?: [string, string, unknown][] | null;
}

export interface ExcelSource {
  kind: "excel";
  path: string;
  sheet?: string | number;
  header?: number | null;
  usecols?: string[] | null;
}

export interface JsonSource {
  kind: "json";
  path: string;
  lines?: boolean;
  encoding?: string;
  record_path?: string | null;
}

export interface SqlSource {
  kind: "sql";
  url_env: string;
  query: string;
}

export interface DatasetSource {
  kind: "dataset";
  workspace: string;
  role?: "train" | "test";
  labeled?: boolean;
}

/** File-only sources usable as workspace X / y. */
export type FileSourceSpec = CsvSource | ParquetSource | ExcelSource | JsonSource;

/** Full SourceSpec union (keys may also take dataset / sql). */
export type SourceSpec = FileSourceSpec | DatasetSource | SqlSource;

/* ---------- Result ---------- */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ResultTable {
  title: string;
  records: Record<string, JsonValue>[];
  group?: string | null;
  kind?: "steps" | null;
}

export interface ResultFigure {
  title: string;
  plotly: Record<string, unknown>;
  group?: string | null;
}

export interface Result {
  metrics: Record<string, string | number>;
  tables: ResultTable[];
  figures: ResultFigure[];
  text: string;
}

/* ---------- Keys / transforms ---------- */

export interface KeyInfo {
  id: string;
  title: string;
  category: string;
  description: string;
  needs_target: boolean;
}

export interface TransformInfo {
  op: string;
  title: string;
  description: string;
  needs_target: boolean;
}

export interface SourceColumn {
  name: string;
  dtype: string;
  numeric: boolean;
}

/* ---------- Workspace ---------- */

export interface DatasetSpec {
  x: FileSourceSpec;
  y?: FileSourceSpec | null;
  target_column?: string | null;
}

export interface Datasets {
  train: DatasetSpec;
  test?: DatasetSpec | null;
}

export interface LabelJoin {
  mode: "order" | "key";
  key?: string | null;
}

export interface MergeSpec {
  source: FileSourceSpec;
  key: string;
  apply_to: "train" | "test" | "both";
  columns?: string[] | null;
}

export interface VariableSpec {
  name: string;
  stat: string;
  column: string;
}

export type StepTarget = "train" | "test" | "both";

export interface Step {
  op: string;
  target: StepTarget;
  params: Record<string, unknown>;
  /** Front-only: alignment steps stay first in the pipeline (MAT-126). */
  align?: boolean;
}

export interface Workspace {
  name: string;
  datasets: Datasets;
  label: LabelJoin;
  merges: MergeSpec[];
  variables: VariableSpec[];
  steps: Step[];
}

export interface ExportRequest {
  out_dir: string;
  overwrite?: boolean;
}

export interface ExportOutputEntry {
  path: string;
  rows?: number;
  columns?: string[];
  sha256?: string;
  [key: string]: unknown;
}

export interface ExportManifest {
  generator: string;
  manifest_version: number | string;
  workspace: string;
  exported_at: string;
  versions: Record<string, string>;
  sources: Record<string, unknown>[];
  label: LabelJoin;
  steps: Record<string, unknown>[];
  /** Engine returns a map role → output meta (not an array). */
  outputs: Record<string, ExportOutputEntry> | ExportOutputEntry[];
  [key: string]: unknown;
}

export interface WorkspacePreview {
  shape: [number, number];
  columns: string[];
  head: Record<string, JsonValue>[];
}

export interface UploadResponse {
  path: string;
}

/* ---------- MAT-127: workspace inspect ---------- */

/** Engine kinds (verified): number | binary | bool | text | date | identifier */
export type ColumnKind =
  | "number"
  | "binary"
  | "bool"
  | "text"
  | "date"
  | "identifier"
  | "num"
  | "bin"
  | "cat"
  | "id"
  | string;

export interface WorkspaceRowsColumn {
  name: string;
  dtype: string;
  kind: ColumnKind;
}

export type WorkspaceRow = Record<string, JsonValue> & { _rid: number };

export interface WorkspaceRows {
  columns: WorkspaceRowsColumn[];
  rows: WorkspaceRow[];
  total: number;
  version: number;
}

export interface SentinelCandidate {
  value: JsonValue;
  count: number;
}

export interface Histogram {
  edges: number[];
  counts: number[];
}

export interface TopValue {
  value: JsonValue;
  count: number;
}

export interface IqrBounds {
  lo: number;
  hi: number;
}

export interface Variants {
  raw: number;
  normalized: number;
}

export interface ColumnProfile {
  name: string;
  kind: ColumnKind;
  count: number;
  missing: number;
  sentinel_candidates: SentinelCandidate[];
  distinct: number;
  histogram: Histogram | null;
  top_values: TopValue[] | null;
  iqr_bounds: IqrBounds | null;
  outliers: number;
  variants: Variants | null;
  looks_like_dates: boolean;
  numbers_as_text: boolean;
  /** Detected currency / money format, or null when not currency-as-text. */
  currency_as_text: {
    decimal: "." | ",";
    thousands: "," | "." | " " | null;
    percent: boolean;
  } | null;
  skewed: boolean;
}

/** POST /workspace/profiles → { columns, version } */
export interface ColumnProfiles {
  columns: ColumnProfile[];
  version: number;
}

export interface PreviewStepChange {
  _rid: number;
  column: string;
  before: JsonValue;
  after: JsonValue;
}

export interface PreviewStep {
  shape: [number, number];
  columns: string[];
  added_columns: string[];
  removed_columns: string[];
  removed_rids: number[];
  changed: PreviewStepChange[];
  changed_total: number;
  state: Record<string, JsonValue>;
  fitted_on: "train" | "test" | null;
}

export interface AlignSide {
  name: string;
  kind: ColumnKind;
  samples: JsonValue[];
}

export type AlignStatus =
  | "match"
  | "type_mismatch"
  | "value_mismatch"
  | "missing_in_test"
  | "extra_in_test"
  | "label"
  | string;

/** Test-only category value with row count (align_report value_mismatch). */
export interface AlignOnlyInTestValue {
  value: string;
  count: number;
}

/** Near-match pair for map-on-test (align_report value_mismatch). */
export interface AlignNearMatch {
  test: string;
  train: string;
}

export interface AlignReportRow {
  train: AlignSide | null;
  test: AlignSide | null;
  status: AlignStatus;
  numbers_as_text: boolean;
  train_mean: number | null;
  test_mean: number | null;
  similar: string[];
  /** Present on value_mismatch; null / [] on other statuses. */
  only_in_test?: AlignOnlyInTestValue[] | null;
  pct_test_rows_unseen?: number | null;
  near_match_hint?: string | null;
  near_matches?: AlignNearMatch[] | null;
  /**
   * Engine severity for value_mismatch (MAT-179). When absent (older engines),
   * the front derives it via isBlockingValueMismatch.
   */
  blocking?: boolean | null;
}

/** POST /workspace/align → { columns: [...] } */
export interface AlignReport {
  columns: AlignReportRow[];
}

/* ---------- Errors ---------- */

export interface ErrorBody {
  type: string;
  message: string;
}

export class EngineError extends Error {
  readonly type: string;
  /** HTTP status when thrown from the API client; unset for local throws. */
  readonly status: number | null;

  constructor(type: string, message: string, status: number | null = null) {
    super(message);
    this.name = "EngineError";
    this.type = type;
    this.status = status;
  }
}

export type Role = "train" | "test";
