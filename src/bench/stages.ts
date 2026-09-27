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
  drop_duplicates: "clean",
  replace_sentinels: "clean",
  standardize_text: "clean",
  map_value: "clean",
  impute: "clean",
  clip: "clean",
  onehot: "transform",
  ordinal: "transform",
  log1p: "transform",
  scale: "transform",
  datetime_parts: "transform",
  derive: "transform",
  drop_columns: "select",
  formula: "custom",
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
]);

export function stepStage(op: string, align?: boolean): StageId {
  if (align) return "import";
  return OP_STAGE[op] ?? "transform";
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
      ].filter(Boolean);
      return `${cols.join(", ")} · ${bits.join(" + ") || "no change"}`;
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
    default:
      return op;
  }
}
