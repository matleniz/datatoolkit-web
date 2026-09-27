import type {
  CsvSource,
  Datasets,
  FileSourceSpec,
  LabelJoin,
  MergeSpec,
  Result,
  Step,
  Workspace,
} from "../../api/types";

export type FileRole = "trainX" | "trainY" | "testX" | "merge" | "ignore";

export interface SourceFileItem {
  id: string;
  name: string;
  path: string;
  cols: string[];
  detected?: string;
  spec: FileSourceSpec;
  rowCount?: number;
  isGuessed?: boolean;
}

/** Front-only Sources UI state kept per workspace name. */
export interface WorkspaceSourcesState {
  files: SourceFileItem[];
  roles: Record<string, FileRole>;
  guessedMap: Record<string, boolean>;
  labelMode: "yfile" | "column";
  yJoin: "order" | "key";
  targetCol: string | null;
  mergeKey: string | null;
  mergeInTest: boolean;
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

  if (lower.includes("label") || lower.includes("target") || lower.includes("_y.")) {
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

export function isIndexColumnName(name: string): boolean {
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

/**
 * Pure mapping from user choices on Sources screen to a valid Workspace JSON object.
 */
export function buildWorkspaceJson(
  input: WorkspaceBuildInput,
): WorkspaceBuildResult {
  const errors: string[] = [];
  const info: { y?: string; merge?: string } = {};
  const originMap: Record<string, "x" | "y" | "merge"> = {};

  const byRole = (role: FileRole) =>
    input.files.filter((f) => input.roles[f.id] === role);

  const trainXFiles = byRole("trainX");
  const testXFiles = byRole("testX");
  const trainYFiles = byRole("trainY");
  const mergeFiles = byRole("merge");

  if (trainXFiles.length === 0) {
    errors.push("Pick a Train X file.");
  } else if (trainXFiles.length > 1) {
    errors.push("Only one file can be Train X.");
  }

  if (testXFiles.length > 1) {
    errors.push("Only one file can be Test X.");
  }

  const trainX = trainXFiles[0];
  const testX = testXFiles[0];
  const trainY = trainYFiles[0];
  const mergeF = mergeFiles[0];

  let targetLabel: string | null = null;

  // Build dataset X
  const trainXSpec: FileSourceSpec = trainX
    ? structuredClone(trainX.spec)
    : { kind: "csv", path: "" };

  if (trainX) {
    trainX.cols.forEach((c) => {
      originMap[c] = "x";
    });
  }

  let testXSpec: FileSourceSpec | undefined;
  if (testX) {
    testXSpec = structuredClone(testX.spec);
    if (testXSpec.kind === "csv" && input.testDecimal) {
      (testXSpec as CsvSource).decimal = input.testDecimal;
    }
  }

  // Target handling
  let trainYSpec: FileSourceSpec | null = null;
  let targetColumn: string | null = null;
  let labelJoin: LabelJoin = { mode: "order" };

  if (input.labelMode === "yfile") {
    if (!trainY) {
      errors.push(
        "Give a file the role “Train y”, or pick a column of train X as the target.",
      );
    } else {
      trainYSpec = structuredClone(trainY.spec);
      const valueCol = yLabelValueColumn(trainY.cols);
      if (valueCol) {
        originMap[valueCol] = "y";
        targetLabel = valueCol;
      }

      if (input.yJoin === "key") {
        labelJoin = { mode: "key", key: input.targetCol ?? undefined };
        const commonWithX = trainX
          ? getCommonColumns(trainX.cols, trainY.cols)
          : [];
        if (commonWithX.length === 0) {
          errors.push(
            `${trainY.name} has no column in common with train X for key join.`,
          );
        } else if (!input.targetCol || !commonWithX.includes(input.targetCol)) {
          labelJoin.key = commonWithX[0];
        }
      } else {
        labelJoin = { mode: "order" };
        if (
          trainX &&
          trainX.rowCount !== undefined &&
          trainY.rowCount !== undefined &&
          trainX.rowCount !== trainY.rowCount
        ) {
          errors.push(
            `Label join by order refuses: ${trainY.name} has ${trainY.rowCount} rows, train X has ${trainX.rowCount}.`,
          );
        } else if (trainY.rowCount !== undefined) {
          info.y = `${trainY.rowCount} labels joined row by row · 0 rows lost`;
        }
      }
    }
  } else {
    // Column mode
    if (input.targetCol && trainX && trainX.cols.includes(input.targetCol)) {
      targetColumn = input.targetCol;
      targetLabel = input.targetCol;
      info.y = `target = column “${targetColumn}” of train X`;
    } else {
      info.y = "Pick the target column.";
    }
  }

  // Merge handling
  const merges: MergeSpec[] = [];
  if (mergeF) {
    if (!trainX) {
      errors.push("Train X required to configure merge.");
    } else {
      const common = getCommonColumns(trainX.cols, mergeF.cols);
      const chosenKey = input.mergeKey ?? common[0];
      if (!chosenKey || !common.includes(chosenKey)) {
        errors.push(
          `Merge key must exist in train X and ${mergeF.name}.`,
        );
      } else {
        merges.push({
          source: structuredClone(mergeF.spec),
          key: chosenKey,
          apply_to: input.mergeInTest ? "both" : "train",
        });

        // Extra merge columns get origin 'merge'
        mergeF.cols
          .filter((c) => c !== chosenKey)
          .forEach((c) => {
            originMap[c] = "merge";
          });

        const trainRows = trainX.rowCount ?? "n";
        info.merge = `train: ${trainRows} / ${trainRows} rows matched`;
        if (input.mergeInTest && testX) {
          const testRows = testX.rowCount ?? "n";
          info.merge += ` · test: ${testRows} / ${testRows}`;
        }
        info.merge += " · 0 rows lost (left join)";
      }
    }
  }

  const datasets: Datasets = {
    train: {
      x: trainXSpec,
      ...(trainYSpec ? { y: trainYSpec } : {}),
      ...(targetColumn ? { target_column: targetColumn } : {}),
    },
    ...(testXSpec ? { test: { x: testXSpec } } : {}),
  };

  const workspace: Workspace = {
    name: input.name,
    datasets,
    label: labelJoin,
    merges,
    variables: [],
    steps: input.steps ?? [],
  };

  return {
    workspace,
    errors,
    info,
    targetLabel,
    originMap,
  };
}

export interface FileInspectMapped {
  /** SourceSpec ready to pass to source_columns / workspace load. */
  spec: FileSourceSpec;
  /** 0-based pandas `header` from load_spec (not 1-based header_line). */
  header: number | null;
  /** Human-readable detected line for the Files table. */
  detected: string;
}

/**
 * Map a file_inspect Result to load_spec + detected summary.
 * Prefer `load_spec.header` (and Excel `suggested_header`) over `header_line`
 * which is a 1-based file line number. Shape must be supplied separately
 * (engine does not put row counts in file_inspect metrics).
 */
export function mapFileInspect(
  result: Result,
  shape?: [number, number] | null,
): FileInspectMapped {
  const metrics = result.metrics ?? {};
  let spec: FileSourceSpec = { kind: "csv", path: "" };

  if (typeof metrics.load_spec === "string" && metrics.load_spec) {
    try {
      const parsed = JSON.parse(metrics.load_spec) as FileSourceSpec;
      if (parsed && typeof parsed === "object" && "kind" in parsed) {
        spec = parsed;
      }
    } catch {
      // keep default
    }
  }

  // Excel sheets table may carry suggested_header (0-based).
  const sheets = result.tables?.find((t) => t.title === "sheets");
  const firstSheet = sheets?.records?.[0];
  if (
    firstSheet &&
    typeof firstSheet.suggested_header === "number" &&
    (!("header" in spec) || (spec as CsvSource).header === undefined)
  ) {
    (spec as CsvSource).header = firstSheet.suggested_header as number;
  }

  let header: number | null = null;
  if (spec.kind === "csv" || spec.kind === "excel") {
    const h = (spec as CsvSource).header;
    header = h === undefined ? null : h;
  }

  const detected = formatDetected(metrics, shape ?? null, header);
  return { spec, header, detected };
}

/**
 * Format detected specs from file_inspect key output.
 * `header` is the 0-based load_spec value when known; falls back to metrics
 * only when load_spec was missing.
 */
export function formatDetected(
  metrics: Record<string, unknown>,
  shape?: [number, number] | null,
  headerOverride?: number | null,
): string {
  const parts: string[] = ["csv"];
  const delimRaw = String(metrics.delimiter ?? ",");
  // Engine may send repr("','") or "," — normalise for display.
  const delim = delimRaw.replace(/^'|'$/g, "").replace(/'/g, '"') || ",";
  parts.push(`sep ${delim.startsWith('"') ? delim : JSON.stringify(delim)}`);

  const enc = String(metrics.encoding_guess ?? "utf-8");
  parts.push(enc);

  let header: number | string;
  if (headerOverride !== undefined && headerOverride !== null) {
    header = headerOverride;
  } else if (typeof metrics.load_spec === "string") {
    try {
      const parsed = JSON.parse(metrics.load_spec) as { header?: number | null };
      header = parsed.header ?? 0;
    } catch {
      header = 0;
    }
  } else {
    header = 0;
  }
  parts.push(`header ${header}`);

  if (shape && shape[0] !== undefined && shape[1] !== undefined) {
    parts.push(`${shape[0]} × ${shape[1]}`);
  }

  if (metrics.decimal_guess === ",") {
    parts.push('decimal "," seen');
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
