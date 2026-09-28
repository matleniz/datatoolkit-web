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

export const STAGE_COLOR: Record<StageId, string> = {
  import: "#6b5ea8",
  clean: "#b4460f",
  transform: "#1d5b86",
  select: "#2f6b3a",
  custom: "#8a5a9e",
};

export const STAGE_NAME: Record<StageId, string> = {
  import: "Import & align",
  clean: "Clean",
  transform: "Encode & transform",
  select: "Select",
  custom: "Custom formula",
};

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

/** Short sub-label for a step (pipeline / recipe). */
export function stepSubLabel(
  op: string,
  params: Record<string, unknown>,
): string {
  switch (op) {
    case "replace_sentinels": {
      const s = params.sentinels as Record<string, unknown[]> | undefined;
      if (!s) return "";
      return Object.entries(s)
        .map(([c, vals]) => `${c} · ${vals.map(String).join(", ")} → NaN`)
        .join("; ");
    }
    case "impute": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return `${cols.join(", ")} · ${String(params.strategy ?? "")}`;
    }
    case "onehot": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return cols.join(", ");
    }
    case "standardize_text": {
      const cols = (params.columns as string[] | undefined) ?? [];
      const bits = [
        params.strip ? "strip" : "",
        params.lower ? "lower" : "",
        params.unify_separators ? "unify separators" : "",
      ].filter(Boolean);
      return `${cols.join(", ")} · ${bits.join(" + ") || "no change"}`;
    }
    case "to_numeric": {
      const cols = (params.columns as string[] | undefined) ?? [];
      const bits = [
        `dec ${String(params.decimal ?? ".")}`,
        params.thousands != null && params.thousands !== ""
          ? `thou ${String(params.thousands)}`
          : "",
        params.percent ? "%" : "",
      ].filter(Boolean);
      return `${cols.join(", ")} · ${bits.join(" · ")}`;
    }
    case "extract": {
      const col = String(params.column ?? "");
      const pattern = String(params.pattern ?? "");
      if (!col && !pattern) return "";
      return pattern ? `${col} · ${pattern}` : col;
    }
    case "drop_high_missing": {
      const thr = params.threshold ?? 0.5;
      const tgt = params.target ? ` · keep ${String(params.target)}` : "";
      return `>${String(thr)}${tgt}`;
    }
    case "clip": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return `${cols.join(", ")} · p${String(params.lower)}–p${String(params.upper)}`;
    }
    case "scale": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return `${cols.length} col · ${String(params.method)}`;
    }
    case "rename": {
      const m = params.mapping as Record<string, string> | undefined;
      if (!m) return "";
      return Object.entries(m)
        .map(([a, b]) => `${a} → ${b}`)
        .join(", ");
    }
    case "cast": {
      const d = params.dtypes as Record<string, string> | undefined;
      if (!d) return "";
      return Object.entries(d)
        .map(([c, t]) => `${c} → ${t}`)
        .join(", ");
    }
    case "drop_columns": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return cols.join(", ");
    }
    case "drop_duplicates":
      return `exact rows · keep ${String(params.keep ?? "none")}`;
    case "filter_rows": {
      const conds = params.conditions as
        | Array<{ column?: string; op?: string; value?: unknown }>
        | undefined;
      if (!conds || !conds.length) return "";
      const parts = conds
        .map((c) => {
          if (!c.column) return "";
          if (c.op === "isna") return `${c.column} is missing`;
          if (c.op === "notna") return `${c.column} not missing`;
          const val =
            c.value === null || c.value === undefined
              ? ""
              : Array.isArray(c.value)
                ? `[${c.value.join(", ")}]`
                : String(c.value);
          return `${c.column} ${c.op ?? "=="} ${val}`;
        })
        .filter(Boolean);
      return parts.join(params.combine === "or" ? " or " : " and ");
    }
    case "ordinal": {
      const cats = params.categories as Record<string, unknown[]> | undefined;
      if (!cats) return "";
      return Object.entries(cats)
        .map(([c, order]) => `${c} · ${order.map(String).join(" < ")}`)
        .join("; ");
    }
    case "formula":
      return `${String(params.name ?? "")} = ${String(params.expr ?? "")}`;
    case "log1p":
    case "parse_dates": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return cols.join(", ");
    }
    case "datetime_parts":
      return `${String(params.column ?? "")} · month, dayofweek`;
    case "derive":
      return `${String(params.a)} ${String(params.op ?? params.kind)} ${String(params.b)}`;
    case "ffill": {
      const cols = (params.columns as string[] | undefined) ?? [];
      const s = params.sort_by ? `sort by ${String(params.sort_by)}` : "";
      return cols.length ? `${cols.join(", ")} · ${s}` : s;
    }
    case "impute_knn": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return `${cols.join(", ")} · k=${String(params.n_neighbors ?? 5)}`;
    }
    case "impute_iterative": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return `${cols.join(", ")} · iter=${String(params.max_iter ?? 10)}`;
    }
    case "drop_missing_target":
      return String(params.target ?? "");
    case "bin":
      return `${String(params.column ?? "")} · ${String(params.mode ?? "qcut")}`;
    case "interactions": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return cols.join(" × ");
    }
    case "polynomial": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return `${cols.join(", ")} · deg ${String(params.degree ?? 2)}`;
    }
    case "power_transform": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return `${cols.join(", ")} · ${String(params.method ?? "yeo-johnson")}`;
    }
    case "quantile_transform": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return `${cols.join(", ")} · ${String(params.output_distribution ?? "uniform")}`;
    }
    case "spline": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return `${cols.join(", ")} · knots ${String(params.n_knots ?? 5)}`;
    }
    case "group_agg":
      return `${String(params.value ?? "")} by ${String(params.group ?? "")}`;
    case "cyclical":
      return `${String(params.column ?? "")} · period ${String(params.period ?? "")}`;
    case "drop_low_variance":
      return `var ≤ ${String(params.threshold ?? 0)}`;
    case "drop_correlated":
      return `|r| ≥ ${String(params.threshold ?? 0.95)}`;
    case "select_k_best":
      return `k=${String(params.k ?? "")} · ${String(params.score ?? "mutual_info")}`;
    case "select_from_model":
      return `${String(params.model ?? "tree")}`;
    case "pca":
      return `n=${String(params.n_components ?? "0.95")}`;
    case "align_to_train": {
      const cols = (params.columns as string[] | undefined) ?? [];
      return `${cols.join(", ")} · ${String(params.mode ?? "shift_mean")}`;
    }
    default:
      return op;
  }
}
