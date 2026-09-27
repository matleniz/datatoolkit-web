import type {
  CsvSource,
  Datasets,
  FileSourceSpec,
  LabelJoin,
  MergeSpec,
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
      trainY.cols.forEach((c) => {
        originMap[c] = "y";
      });
      targetLabel = trainY.cols[0] ?? null;

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

/**
 * Format detected specs from file_inspect key output.
 */
export function formatDetected(
  metrics: Record<string, unknown>,
  shape?: [number, number],
): string {
  const parts: string[] = ["csv"];
  const delim = String(metrics.delimiter ?? ",");
  parts.push(`sep ${delim.replace(/'/g, '"')}`);

  const enc = String(metrics.encoding_guess ?? "utf-8");
  parts.push(enc);

  const header = metrics.header_line !== undefined ? metrics.header_line : 0;
  parts.push(`header ${header}`);

  if (shape) {
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
