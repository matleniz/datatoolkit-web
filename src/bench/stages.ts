/**
 * Course-stage map from the prototype OPS.*.stage.
 * Alignment steps (`align: true`) always render as import.
 */

export type StageId = "import" | "clean" | "transform" | "select" | "custom";

export interface StageInfo {
  id: StageId;
  label: string;
  course: string;
  color: string;
}

export const STAGES: StageInfo[] = [
  {
    id: "import",
    label: "Import & align",
    course: "Courses 1–3 · shapes, files, databases",
    color: "#6b5ea8",
  },
  {
    id: "clean",
    label: "Clean",
    course: "Courses 5–7 · duplicates, missing values, outliers",
    color: "#b4460f",
  },
  {
    id: "transform",
    label: "Encode & transform",
    course: "Courses 8–10 · encoding, features, scaling",
    color: "#1d5b86",
  },
  {
    id: "select",
    label: "Select",
    course: "Course 11 · feature selection",
    color: "#2f6b3a",
  },
  {
    id: "custom",
    label: "Custom formula",
    course: "Your own expressions",
    color: "#8a5a9e",
  },
];

export const STAGE_COLOR = Object.fromEntries(
  STAGES.map((st) => [st.id, st.color]),
) as Record<StageId, string>;

export const STAGE_NAME = Object.fromEntries(
  STAGES.map((st) => [st.id, st.label]),
) as Record<StageId, string>;

/** Ops shown in the step picker, grouped by course stage (prototype OPS). */
export const OP_STAGE: Record<string, StageId> = {
  parse_dates: "import",
  rename: "import",
  cast: "import",
  align_to_train: "import",
  drop_duplicates: "clean",
  replace_sentinels: "clean",
  standardize_text: "clean",
  map_value: "clean",
  to_numeric: "clean",
  extract: "clean",
  drop_high_missing: "clean",
  impute: "clean",
  clip: "clean",
  ffill: "clean",
  impute_knn: "clean",
  impute_iterative: "clean",
  drop_missing_target: "clean",
  filter_rows: "clean",
  onehot: "transform",
  ordinal: "transform",
  log1p: "transform",
  scale: "transform",
  datetime_parts: "transform",
  derive: "transform",
  bin: "transform",
  interactions: "transform",
  polynomial: "transform",
  power_transform: "transform",
  quantile_transform: "transform",
  spline: "transform",
  group_agg: "transform",
  cyclical: "transform",
  drop_columns: "select",
  drop_low_variance: "select",
  drop_correlated: "select",
  select_k_best: "select",
  select_from_model: "select",
  pca: "select",
  formula: "custom",
};

/** Ops excluded from the generic step picker, with an explicit reason. */
export const EXCLUDED_OPS: Record<string, string> = {
  // Engine lists these; Studio picker/editor not wired yet (MAT-197).
  polynomial: "Not yet exposed in the step picker (MAT-197)",
  power_transform: "Not yet exposed in the step picker (MAT-197)",
  quantile_transform: "Not yet exposed in the step picker (MAT-197)",
  spline: "Not yet exposed in the step picker (MAT-197)",
};

/** Ops that learn state on train (fitted badge). */
export const FITTING_OPS = new Set([
  "impute",
  "clip",
  "onehot",
  "scale",
  "formula",
  "impute_knn",
  "impute_iterative",
  "bin",
  "pca",
  "select_k_best",
  "select_from_model",
  "drop_low_variance",
  "drop_correlated",
  "align_to_train",
  "drop_missing_target",
  "drop_high_missing",
  "group_agg",
  "polynomial",
  "power_transform",
  "quantile_transform",
  "spline",
]);

export function stepStage(op: string, align?: boolean): StageId {
  if (align) return "import";
  return OP_STAGE[op] ?? "transform";
}

/** Human title for an op (pipeline node / preview banner). */
export function opTitle(op: string): string {
  const map: Record<string, string> = {
    replace_sentinels: "Replace sentinels",
    impute: "Impute",
    onehot: "One-hot",
    standardize_text: "Standardize text",
    to_numeric: "Parse numeric text",
    extract: "Extract by regex",
    drop_high_missing: "Drop high-missing columns",
    drop_columns: "Drop columns",
    drop_duplicates: "Drop duplicates",
    rename: "Rename",
    cast: "Cast type",
    clip: "Clip",
    scale: "Scale",
    ordinal: "Ordinal",
    formula: "Formula",
    log1p: "log1p",
    parse_dates: "Parse dates",
    datetime_parts: "Date parts",
    derive: "Derive",
    map_value: "Map a value",
    ffill: "Forward fill",
    impute_knn: "Impute (KNN)",
    impute_iterative: "Impute (iterative)",
    drop_missing_target: "Drop rows with missing target",
    filter_rows: "Filter rows",
    bin: "Bin column",
    interactions: "Interactions",
    polynomial: "Polynomial features",
    power_transform: "Power transform",
    quantile_transform: "Quantile transform",
    spline: "Spline features",
    group_agg: "Group aggregate",
    cyclical: "Cyclical encoding",
    drop_low_variance: "Drop low variance",
    drop_correlated: "Drop correlated",
    select_k_best: "Select k best",
    select_from_model: "Select from model",
    pca: "PCA",
    align_to_train: "Align to train",
  };
  return map[op] ?? op;
}

/**
 * Human summary for the live-preview banner / pending node:
 * "Impute · age · median".
 */
export function stepSummary(
  op: string,
  params: Record<string, unknown>,
): string {
  const sub = stepSubLabel(op, params);
  const title = opTitle(op);
  return sub ? `${title} · ${sub}` : title;
}

type Params = Record<string, unknown>;

const cols = (p: Params) => (p.columns as string[] | undefined) ?? [];
const str = (v: unknown) => String(v);
/** "a, b · <detail>" — the shape most column ops share. */
const colsWith = (detail: (p: Params) => string) => (p: Params) =>
  `${cols(p).join(", ")} · ${detail(p)}`;
/** One entry per key of a column-keyed object param. */
const perColumn =
  <T>(key: string, fmt: (col: string, v: T) => string, sep = ", ") =>
  (p: Params) =>
    Object.entries((p[key] as Record<string, T> | undefined) ?? {})
      .map(([c, v]) => fmt(c, v))
      .join(sep);

function conditionLabel(c: { column?: string; op?: string; value?: unknown }): string {
  if (!c.column) return "";
  if (c.op === "isna") return `${c.column} is missing`;
  if (c.op === "notna") return `${c.column} not missing`;
  let val = "";
  if (Array.isArray(c.value)) val = `[${c.value.join(", ")}]`;
  else if (c.value !== null && c.value !== undefined) val = String(c.value);
  return `${c.column} ${c.op ?? "=="} ${val}`;
}

function textBits(p: Params): string {
  const bits = [
    p.strip ? "strip" : "",
    p.lower ? "lower" : "",
    p.unify_separators ? "unify separators" : "",
  ].filter(Boolean);
  return bits.join(" + ") || "no change";
}

function numericTextBits(p: Params): string {
  const thousands = p.thousands != null && p.thousands !== "" ? `thou ${str(p.thousands)}` : "";
  return [`dec ${str(p.decimal ?? ".")}`, thousands, p.percent ? "%" : ""]
    .filter(Boolean)
    .join(" · ");
}

const SUB_LABEL: Record<string, (p: Params) => string> = {
  replace_sentinels: perColumn<unknown[]>(
    "sentinels",
    (c, vals) => `${c} · ${vals.map(String).join(", ")} → NaN`,
    "; ",
  ),
  impute: colsWith((p) => str(p.strategy ?? "")),
  onehot: (p) => cols(p).join(", "),
  standardize_text: colsWith(textBits),
  to_numeric: colsWith(numericTextBits),
  extract: (p) => {
    const col = str(p.column ?? "");
    const pattern = str(p.pattern ?? "");
    return pattern ? `${col} · ${pattern}` : col;
  },
  drop_high_missing: (p) =>
    `>${str(p.threshold ?? 0.5)}${p.target ? ` · keep ${str(p.target)}` : ""}`,
  clip: colsWith((p) => `p${str(p.lower)}–p${str(p.upper)}`),
  scale: (p) => `${cols(p).length} col · ${str(p.method)}`,
  rename: perColumn<string>("mapping", (a, b) => `${a} → ${b}`),
  cast: perColumn<string>("dtypes", (c, t) => `${c} → ${t}`),
  drop_columns: (p) => cols(p).join(", "),
  drop_duplicates: (p) => `exact rows · keep ${str(p.keep ?? "none")}`,
  filter_rows: (p) =>
    ((p.conditions as Parameters<typeof conditionLabel>[0][] | undefined) ?? [])
      .map(conditionLabel)
      .filter(Boolean)
      .join(p.combine === "or" ? " or " : " and "),
  ordinal: perColumn<unknown[]>(
    "categories",
    (c, order) => `${c} · ${order.map(String).join(" < ")}`,
    "; ",
  ),
  formula: (p) => `${str(p.name ?? "")} = ${str(p.expr ?? "")}`,
  log1p: (p) => cols(p).join(", "),
  parse_dates: (p) => cols(p).join(", "),
  datetime_parts: (p) => `${str(p.column ?? "")} · month, dayofweek`,
  derive: (p) => `${str(p.a)} ${str(p.op ?? p.kind)} ${str(p.b)}`,
  ffill: (p) => {
    const s = p.sort_by ? `sort by ${str(p.sort_by)}` : "";
    return cols(p).length ? `${cols(p).join(", ")} · ${s}` : s;
  },
  impute_knn: colsWith((p) => `k=${str(p.n_neighbors ?? 5)}`),
  impute_iterative: colsWith((p) => `iter=${str(p.max_iter ?? 10)}`),
  drop_missing_target: (p) => str(p.target ?? ""),
  bin: (p) => `${str(p.column ?? "")} · ${str(p.mode ?? "qcut")}`,
  interactions: (p) => cols(p).join(" × "),
  polynomial: colsWith((p) => `deg ${str(p.degree ?? 2)}`),
  power_transform: colsWith((p) => str(p.method ?? "yeo-johnson")),
  quantile_transform: colsWith((p) => str(p.output_distribution ?? "uniform")),
  spline: colsWith((p) => `knots ${str(p.n_knots ?? 5)}`),
  group_agg: (p) => `${str(p.value ?? "")} by ${str(p.group ?? "")}`,
  cyclical: (p) => `${str(p.column ?? "")} · period ${str(p.period ?? "")}`,
  drop_low_variance: (p) => `var ≤ ${str(p.threshold ?? 0)}`,
  drop_correlated: (p) => `|r| ≥ ${str(p.threshold ?? 0.95)}`,
  select_k_best: (p) => `k=${str(p.k ?? "")} · ${str(p.score ?? "mutual_info")}`,
  select_from_model: (p) => str(p.model ?? "tree"),
  pca: (p) => `n=${str(p.n_components ?? "0.95")}`,
  align_to_train: colsWith((p) => str(p.mode ?? "shift_mean")),
};

/** Short sub-label for a step (pipeline / recipe). */
export function stepSubLabel(op: string, params: Params): string {
  return SUB_LABEL[op]?.(params) ?? op;
}
