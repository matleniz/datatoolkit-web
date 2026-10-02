import type { FileSourceSpec } from "../api/types";

/**
 * Sources screen file state kept per workspace (`AppState.filesByWorkspace`).
 * Types only; the logic stays in screens/sources/sourcesLogic, which
 * re-exports them.
 */

export type FileRole = "trainX" | "trainY" | "testX" | "merge" | "ignore";

/** One row from file_inspect's `sheets` table (Excel). */
export interface SheetInfo {
  sheet: string;
  rows: number;
  cols: number;
  suggested_header: number;
}

/** One row from file_inspect's `record_paths` table (enveloped JSON). */
export interface RecordPathInfo {
  record_path: string;
  records: number;
}

export interface SourceFileItem {
  id: string;
  name: string;
  path: string;
  cols: string[];
  detected?: string;
  spec: FileSourceSpec;
  rowCount?: number;
  isGuessed?: boolean;
  /** Excel sheet list from file_inspect (for the sheet picker). */
  sheets?: SheetInfo[];
  /** JSON record_path candidates from file_inspect. */
  recordPaths?: RecordPathInfo[];
  /**
   * Engine / kind-mismatch error for this path (MAT-167 / MAT-169).
   * Set on fresh upload when the engine cannot read the file, or on a stored
   * workspace whose path is unreadable / kind-mismatched. When set, Sources
   * must not treat the file as a healthy empty train.
   */
  parseError?: string | null;
}

/** Front-only Sources UI state kept per workspace name. */
export interface WorkspaceSourcesState {
  files: SourceFileItem[];
  roles: Record<string, FileRole>;
  guessedMap: Record<string, boolean>;
  labelMode: "yfile" | "column";
  yJoin: "order" | "key";
  /** Key column of a join by key; null → the default (first id-like common column). */
  yKey: string | null;
  targetCol: string | null;
  mergeKey: string | null;
  mergeInTest: boolean;
}
