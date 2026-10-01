import { apiClient } from "../../api/client";
import type { FileSourceSpec, Workspace } from "../../api/types";
import { E2E_FIXTURES_DIR } from "../../e2eFixtures";
import {
  defaultChurnSources,
  emptyWorkspaceSources,
  engineMessage,
  extractFilesFromWorkspace,
  formatDetectedFromSpec,
  guessFileRole,
  mapFileInspect,
  yLabelValueColumn,
  type FileRole,
  type SourceFileItem,
  type WorkspaceBuildResult,
  type WorkspaceSourcesState,
} from "./sourcesLogic";

/** Offline / empty-cache churn fallback — this checkout's e2e fixtures (MAT-190). */
const FIXTURE_BASE = E2E_FIXTURES_DIR;

/** Shown when train has 0 columns / empty file (MAT-154). */
export const EMPTY_TRAIN_MESSAGE =
  "This train file has no columns (empty or unreadable). Replace it before opening the workbench or checking alignment.";

export const LOADING_SOURCES_MESSAGE = "Loading workspace sources…";

/** Prefix shared by every stored-source parse failure (MAT-167). */
export const STORED_SOURCE_FAILED_PREFIX = "Stored train source failed to parse:";

/** MAT-167: stored path unreadable or kind-mismatched (not a truly empty file). */
export function storedSourceFailedMessage(detail: string): string {
  return `${STORED_SOURCE_FAILED_PREFIX} ${detail}`;
}

/** Display string for a file-level parseError (MAT-167 / MAT-169). */
export function trainParseErrorDisplay(detail: string): string {
  // Kind-mismatch details from enrichFileItem start with "saved as ".
  if (detail.startsWith("saved as ")) {
    return storedSourceFailedMessage(detail);
  }
  // Engine errors already name their type — show verbatim (MAT-169 fresh upload).
  if (/^[A-Za-z]+Error\b/.test(detail)) {
    return detail;
  }
  return storedSourceFailedMessage(detail);
}

/** Minimal workspace: one train X source, order-joined label. */
export function bareWorkspace(name: string, x: FileSourceSpec): Workspace {
  return {
    name,
    datasets: { train: { x } },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

export const emptyWorkspace = (name: string) =>
  bareWorkspace(name, { kind: "csv", path: "" });

export interface PreviewState {
  trainShape: [number, number] | null;
  testShape: [number, number] | null;
  columns: string[] | null;
  target: string | null;
}

export const EMPTY_PREVIEW: PreviewState = {
  trainShape: null,
  testShape: null,
  columns: null,
  target: null,
};

/** Sources to show for a workspace with no stored files (churn demo vs empty). */
export function fallbackSources(name: string): WorkspaceSourcesState {
  return name === "churn"
    ? defaultChurnSources(FIXTURE_BASE)
    : emptyWorkspaceSources();
}

/** Cached sources for a name, else the fallback — the initial `src` state. */
export function initialSourcesFor(
  name: string,
  cache: Record<string, WorkspaceSourcesState>,
): WorkspaceSourcesState {
  return cache[name] ?? fallbackSources(name);
}

export function sourcesFromWorkspace(ws: Workspace): WorkspaceSourcesState {
  const extracted = extractFilesFromWorkspace(ws);
  const guessedMap: Record<string, boolean> = {};
  for (const f of extracted.files) guessedMap[f.id] = false;
  return {
    files: extracted.files,
    roles: extracted.roles,
    guessedMap,
    labelMode: extracted.labelMode,
    yJoin: extracted.yJoin,
    targetCol: extracted.targetCol,
    mergeKey: extracted.mergeKey,
    mergeInTest: extracted.mergeInTest,
  };
}

/** Every source path a workspace references (train x/y, test x, merges). */
function workspacePaths(ws: Workspace | null): Set<string> {
  const paths = new Set<string>();
  if (ws?.datasets.train.x.path) paths.add(ws.datasets.train.x.path);
  if (ws?.datasets.train.y?.path) paths.add(ws.datasets.train.y.path);
  if (ws?.datasets.test?.x?.path) paths.add(ws.datasets.test.x.path);
  for (const m of ws?.merges ?? []) paths.add(m.source.path);
  return paths;
}

/** True when the cached sources still describe the stored workspace. */
export function cacheMatchesWorkspace(
  cached: WorkspaceSourcesState | undefined,
  ws: Workspace | null,
): cached is WorkspaceSourcesState {
  if (!cached || cached.files.length === 0) return false;
  const wsPaths = workspacePaths(ws);
  return (
    wsPaths.size === 0 ||
    cached.files.some((f) => wsPaths.has(f.path) || wsPaths.has(f.spec.path))
  );
}

/** "saved as csv but file_inspect detects json (record_path …)" or null. */
function kindMismatchMessage(
  spec: FileSourceSpec,
  detectedSpec: FileSourceSpec | null,
): string | null {
  if (!detectedSpec || detectedSpec.kind === spec.kind) return null;
  const recordPath =
    detectedSpec.kind === "json" && "record_path" in detectedSpec
      ? (detectedSpec as { record_path?: string }).record_path
      : undefined;
  const jsonExtra = recordPath
    ? ` (record_path ${JSON.stringify(recordPath)})`
    : "";
  return `saved as ${spec.kind} but file_inspect detects ${detectedSpec.kind}${jsonExtra}`;
}

/** file_inspect pass of enrichFileItem; advisory, never throws. */
async function inspectStored(
  item: SourceFileItem,
  path: string,
): Promise<Pick<SourceFileItem, "sheets" | "recordPaths"> & {
  parseError: string | null;
}> {
  let sheets = item.sheets;
  let recordPaths = item.recordPaths;
  let parseError: string | null = null;
  try {
    const mapped = mapFileInspect(await apiClient.runKey("file_inspect", { path }));
    if (mapped.sheets) sheets = mapped.sheets;
    if (mapped.recordPaths) recordPaths = mapped.recordPaths;
    parseError = kindMismatchMessage(item.spec, mapped.spec);
  } catch {
    /* inspect is advisory when the stored spec still loads */
  }
  return { sheets, recordPaths, parseError };
}

/**
 * Refresh columns / shape for a stored file. Surfaces engine read errors and
 * kind mismatches vs file_inspect (legacy workspaces saved as csv).
 */
export async function enrichFileItem(
  item: SourceFileItem,
): Promise<SourceFileItem> {
  let cols = item.cols;
  let rowCount = item.rowCount;
  let detected = item.detected;
  const spec = item.spec;
  const path = spec.path || item.path;

  const inspected = path
    ? await inspectStored(item, path)
    : { sheets: item.sheets, recordPaths: item.recordPaths, parseError: null };
  let parseError = inspected.parseError;

  try {
    const colList = await apiClient.sourceColumns(spec);
    cols = colList.map((c) => c.name);
  } catch (err: unknown) {
    parseError = engineMessage(err);
    cols = [];
  }

  try {
    const preview = await apiClient.previewWorkspace(
      bareWorkspace("inspect", spec),
      "train",
      1,
    );
    rowCount = preview.shape[0];
    detected = formatDetectedFromSpec(spec, preview.shape);
  } catch (err: unknown) {
    if (!parseError) parseError = engineMessage(err);
    detected = formatDetectedFromSpec(spec, null);
  }

  return {
    ...item,
    cols,
    rowCount,
    detected,
    spec,
    sheets: inspected.sheets,
    recordPaths: inspected.recordPaths,
    parseError,
  };
}

/** `path` back-filled into a file_inspect spec that came without one. */
function specWithPath(spec: FileSourceSpec, path: string): FileSourceSpec {
  return spec.path ? spec : { ...spec, path };
}

type UploadInspection =
  | { error: string }
  | {
      item: SourceFileItem;
      role: FileRole;
      parseError: string | null;
      colCount: number;
    };

/**
 * Inspect a freshly uploaded file: kind, columns, shape. Returns the new
 * source item (to append) or an error message to surface.
 */
export async function inspectUploadedFile(
  file: File,
  uploadedPath: string,
  roles: Record<string, FileRole>,
): Promise<UploadInspection> {
  const inspectRes = await apiClient.runKey("file_inspect", {
    path: uploadedPath,
  });
  const noKind = `Could not determine source kind for ${file.name}.`;

  const mapped = mapFileInspect(inspectRes);
  if (mapped.error || !mapped.spec) return { error: mapped.error ?? noKind };
  const spec = specWithPath(mapped.spec, uploadedPath);

  let cols: string[] = [];
  let parseError: string | null = null;
  try {
    const colList = await apiClient.sourceColumns(spec);
    cols = colList.map((c) => c.name);
  } catch (err: unknown) {
    parseError = engineMessage(err);
  }

  let shape: [number, number] | null =
    cols.length > 0 ? [0, cols.length] : null;
  try {
    const preview = await apiClient.previewWorkspace(
      bareWorkspace("inspect", spec),
      "train",
      1,
    );
    shape = preview.shape;
  } catch (err: unknown) {
    if (!parseError) parseError = engineMessage(err);
  }

  const remapped = mapFileInspect(inspectRes, shape);
  if (remapped.error || !remapped.spec) {
    return { error: remapped.error ?? noKind };
  }

  const item: SourceFileItem = {
    id: `f_${Date.now()}`,
    name: file.name,
    path: uploadedPath,
    cols,
    detected: remapped.detected,
    spec: remapped.spec.path ? remapped.spec : spec,
    rowCount: shape?.[0],
    isGuessed: true,
    sheets: remapped.sheets,
    recordPaths: remapped.recordPaths,
    // 0-byte files stay on the MAT-154 empty-train path even if the
    // engine also raises SourceError while reading them.
    parseError: file.size === 0 ? null : parseError,
  };
  return {
    item,
    parseError,
    colCount: cols.length > 0 ? cols.length : (shape?.[1] ?? 0),
    role: guessFileRole(file.name, roles),
  };
}

/** Kinds that often need a manual pick / override of their load options. */
export function opensOptionsByDefault(spec: FileSourceSpec): boolean {
  return spec.kind === "excel" || spec.kind === "json" || spec.kind === "csv";
}

/**
 * Truly empty (0-byte) or 0-column without a parse error → MAT-154 copy.
 * Unreadable non-empty files reuse the MAT-167 parse-error UI (MAT-169).
 */
export function isEmptyUpload(
  file: File,
  parseError: string | null | undefined,
  colCount: number,
): boolean {
  return file.size === 0 || (!parseError && colCount === 0);
}

/** Predicate: engine errors cleared once an Options edit re-parses cleanly. */
export function clearedByOptionsEdit(
  previousParseError: string | null | undefined,
  parseError: string | null | undefined,
  hasCols: boolean,
): ((e: string) => boolean) | null {
  const sameAsPrevious = (e: string) =>
    !!previousParseError && e === previousParseError;
  if (!parseError && hasCols) {
    return (e) =>
      e.startsWith(STORED_SOURCE_FAILED_PREFIX) ||
      e === EMPTY_TRAIN_MESSAGE ||
      sameAsPrevious(e);
  }
  if (parseError) {
    return (e) => e === EMPTY_TRAIN_MESSAGE || sameAsPrevious(e);
  }
  return null;
}

/** Engine errors cleared once a re-inspect succeeds. */
export function clearedByReinspect(e: string): boolean {
  return e.startsWith(STORED_SOURCE_FAILED_PREFIX) || e === EMPTY_TRAIN_MESSAGE;
}

export interface TrainStatus {
  columnCount: number;
  hasPath: boolean;
  parseError: string | null;
  ready: boolean;
  canNavigate: boolean;
  parseErrorHint: string | null;
  emptyTrainHint: string | null;
  navigateBlockReason: string | undefined;
}

/** Gating / hint state of the Train X file for the navigation buttons. */
export function trainStatus(
  trainX: SourceFileItem | undefined,
  preview: PreviewState,
  sourcesLoading: boolean,
): TrainStatus {
  const columnCount =
    preview.trainShape != null
      ? preview.trainShape[1]
      : (trainX?.cols.length ?? 0);
  const hasPath = Boolean(trainX?.spec.path);
  const parseError = trainX?.parseError?.trim() || null;
  const ready = hasPath && columnCount > 0 && !parseError;
  const parseErrorHint = parseError ? trainParseErrorDisplay(parseError) : null;

  let emptyTrainHint: string | null = null;
  if (sourcesLoading) emptyTrainHint = LOADING_SOURCES_MESSAGE;
  else if (hasPath && !parseError && columnCount === 0) {
    emptyTrainHint = EMPTY_TRAIN_MESSAGE;
  }

  let navigateBlockReason: string | undefined;
  if (sourcesLoading) navigateBlockReason = LOADING_SOURCES_MESSAGE;
  else if (parseErrorHint) navigateBlockReason = parseErrorHint;
  else if (!ready) navigateBlockReason = EMPTY_TRAIN_MESSAGE;

  return {
    columnCount,
    hasPath,
    parseError,
    ready,
    canNavigate: !sourcesLoading && ready,
    parseErrorHint,
    emptyTrainHint,
    navigateBlockReason,
  };
}

const formatShape = (shape: [number, number]) => `${shape[0]} × ${shape[1]}`;

/** "rows × cols" of the train result, from the engine preview or the files. */
export function trainShapeText(
  preview: PreviewState,
  src: Pick<WorkspaceSourcesState, "labelMode" | "mergeKey">,
  trainX: SourceFileItem | undefined,
  trainY: SourceFileItem | undefined,
  mergeFile: SourceFileItem | undefined,
): string {
  if (preview.trainShape) return formatShape(preview.trainShape);
  if (!trainX) return "—";
  const yExtra =
    src.labelMode === "yfile" && trainY && yLabelValueColumn(trainY.cols)
      ? 1
      : 0;
  const mergeExtra = mergeFile
    ? mergeFile.cols.filter((c) => c !== src.mergeKey).length
    : 0;
  return `${trainX.rowCount ?? "—"} × ${trainX.cols.length + yExtra + mergeExtra}`;
}

/** "rows × cols" of the test result, from the engine preview or the files. */
export function testShapeText(
  preview: PreviewState,
  src: Pick<WorkspaceSourcesState, "mergeKey" | "mergeInTest">,
  testFile: SourceFileItem | undefined,
  mergeFile: SourceFileItem | undefined,
): string {
  if (preview.testShape) return formatShape(preview.testShape);
  if (!testFile) return "—";
  const mergeExtra =
    src.mergeInTest && mergeFile
      ? mergeFile.cols.filter((c) => c !== src.mergeKey).length
      : 0;
  return `${testFile.rowCount ?? "—"} × ${testFile.cols.length + mergeExtra}`;
}

/** Colour origin of a result column: x, y (label) or merged. */
export function columnOrigin(
  col: string,
  build: WorkspaceBuildResult,
  resolvedTarget: string | null,
  mergeFile: SourceFileItem | undefined,
  effectiveMergeKey: string | null,
): "x" | "y" | "merge" {
  const known = build.originMap[col];
  if (known) return known;
  if (resolvedTarget && col === resolvedTarget) return "y";
  if (mergeFile?.cols.includes(col) && col !== effectiveMergeKey) {
    return "merge";
  }
  return "x";
}

/** Info line under the Target card. */
export function targetInfoText(
  build: WorkspaceBuildResult,
  labelMode: WorkspaceSourcesState["labelMode"],
  hasTrainY: boolean,
  resolvedTarget: string | null,
): string {
  if (build.info.y) return build.info.y;
  if (labelMode !== "yfile") return "";
  if (!hasTrainY) return "No file has the role “Train y”.";
  return resolvedTarget ? `target = “${resolvedTarget}”` : "";
}

/** Engine errors not already shown by the parse-error / empty-train banners. */
export function visibleEngineErrors(
  errors: string[],
  status: Pick<TrainStatus, "emptyTrainHint" | "parseErrorHint" | "parseError">,
): string[] {
  return errors.filter(
    (err) =>
      err !== status.emptyTrainHint &&
      err !== status.parseErrorHint &&
      !(status.parseError && err === status.parseError),
  );
}

/** Whether the empty-train status banner should be rendered. */
export function showEmptyTrainBanner(
  status: Pick<TrainStatus, "emptyTrainHint" | "parseErrorHint">,
  errors: string[],
): boolean {
  return Boolean(
    status.emptyTrainHint &&
      status.emptyTrainHint !== status.parseErrorHint &&
      !errors.includes(status.emptyTrainHint),
  );
}

/** Whether an openWorkspace error is the benign "workspace does not exist yet". */
export function isUnknownWorkspaceError(msg: string): boolean {
  return /unknown workspace|not found/i.test(msg);
}
