import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { rememberWorkspaceName, forgetWorkspaceName } from "../../bootstrap";
import { apiClient } from "../../api/client";
import type { FileSourceSpec, Workspace, WorkspaceSummary } from "../../api/types";
import {
  useAppDispatch,
  useAppState,
  markWorkspaceSaved,
  abandonPendingWorkspaceSave,
} from "../../state/AppStore";
import { allowWorkspaceSave } from "../../state/workspaceSaveGate";
import {
  ALL_ROLES,
  buildWorkspaceJson,
  defaultChurnSources,
  emptyWorkspaceSources,
  engineMessage,
  extractFilesFromWorkspace,
  formatDetectedFromSpec,
  getCommonColumns,
  guessFileRole,
  mapFileInspect,
  ROLE_LABELS,
  targetFromPreviewColumns,
  yLabelValueColumn,
  resultSchemaColumns,
  type FileRole,
  type SourceFileItem,
  type WorkspaceSourcesState,
} from "./sourcesLogic";
import { E2E_FIXTURES_DIR } from "../../e2eFixtures";
import { SourceOptionsEditor } from "./SourceOptionsEditor";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import "./sources.css";

/** Offline / empty-cache churn fallback — this checkout's e2e fixtures (MAT-190). */
const FIXTURE_BASE = E2E_FIXTURES_DIR;

/** Shown when train has 0 columns / empty file (MAT-154). */
const EMPTY_TRAIN_MESSAGE =
  "This train file has no columns (empty or unreadable). Replace it before opening the workbench or checking alignment.";

/** MAT-167: stored path unreadable or kind-mismatched (not a truly empty file). */
function storedSourceFailedMessage(detail: string): string {
  return `Stored train source failed to parse: ${detail}`;
}

/** Display string for a file-level parseError (MAT-167 / MAT-169). */
function trainParseErrorDisplay(detail: string): string {
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
function bareWorkspace(name: string, x: FileSourceSpec): Workspace {
  return {
    name,
    datasets: { train: { x } },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
}

const emptyWorkspace = (name: string) =>
  bareWorkspace(name, { kind: "csv", path: "" });

interface PreviewState {
  trainShape: [number, number] | null;
  testShape: [number, number] | null;
  columns: string[] | null;
  target: string | null;
}

const EMPTY_PREVIEW: PreviewState = {
  trainShape: null,
  testShape: null,
  columns: null,
  target: null,
};

/**
 * Refresh columns / shape for a stored file. Surfaces engine read errors and
 * kind mismatches vs file_inspect (legacy workspaces saved as csv).
 */
async function enrichFileItem(item: SourceFileItem): Promise<SourceFileItem> {
  let cols = item.cols;
  let rowCount = item.rowCount;
  let detected = item.detected;
  let sheets = item.sheets;
  let recordPaths = item.recordPaths;
  let parseError: string | null = null;
  const spec = item.spec;
  const path = spec.path || item.path;

  if (path) {
    try {
      const inspectRes = await apiClient.runKey("file_inspect", { path });
      const mapped = mapFileInspect(inspectRes);
      if (mapped.sheets) sheets = mapped.sheets;
      if (mapped.recordPaths) recordPaths = mapped.recordPaths;
      if (mapped.spec && mapped.spec.kind !== spec.kind) {
        const jsonExtra =
          mapped.spec.kind === "json" &&
          "record_path" in mapped.spec &&
          (mapped.spec as { record_path?: string }).record_path
            ? ` (record_path ${JSON.stringify(
                (mapped.spec as { record_path?: string }).record_path,
              )})`
            : "";
        parseError = `saved as ${spec.kind} but file_inspect detects ${mapped.spec.kind}${jsonExtra}`;
      }
    } catch {
      /* inspect is advisory when the stored spec still loads */
    }
  }

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
    sheets,
    recordPaths,
    parseError,
  };
}

function sourcesFromWorkspace(ws: Workspace): WorkspaceSourcesState {
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

export function SourcesScreen() {
  const { workspace, filesByWorkspace } = useAppState();
  const dispatch = useAppDispatch();
  const fileInputId = useId();

  const [summaries, setSummaries] = useState<WorkspaceSummary[]>([]);
  const [activeWsName, setActiveWsName] = useState<string>(
    workspace?.name ?? "churn",
  );
  const [listError, setListError] = useState<string | null>(null);

  const initialSources = useMemo((): WorkspaceSourcesState => {
    const cached = filesByWorkspace[activeWsName];
    if (cached) return cached;
    if (activeWsName === "churn") return defaultChurnSources(FIXTURE_BASE);
    return emptyWorkspaceSources();
  }, [activeWsName, filesByWorkspace]);

  const [src, setSrc] = useState<WorkspaceSourcesState>(initialSources);
  const { files, roles, guessedMap, labelMode, yJoin, targetCol, mergeKey, mergeInTest } = src;
  const patch = useCallback(
    (p: (s: WorkspaceSourcesState) => Partial<WorkspaceSourcesState>) =>
      setSrc((s) => ({ ...s, ...p(s) })),
    [],
  );

  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const [engineErrors, setEngineErrors] = useState<string[]>([]);
  /** True while a workspace switch is still loading sources (MAT-149). */
  const [sourcesLoading, setSourcesLoading] = useState(false);
  /** File ids with the Options panel open. */
  const [optionsOpen, setOptionsOpen] = useState<Record<string, boolean>>({});
  /** File ids currently re-previewing after an Options edit. */
  const [optionsBusy, setOptionsBusy] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const optionsGenRef = useRef<Record<string, number>>({});
  const persistSkip = useRef(true);
  const activeNameRef = useRef(activeWsName);
  activeNameRef.current = activeWsName;
  /** Bumps on each workspace select so stale loadWorkspaceSources results are ignored. */
  const selectGenRef = useRef(0);

  const pushError = (msg: string) => setEngineErrors((prev) => [...prev, msg]);
  const addError = (msg: string) =>
    setEngineErrors((prev) => (prev.includes(msg) ? prev : [...prev, msg]));
  const dropErrors = (drop: (e: string) => boolean) =>
    setEngineErrors((prev) => prev.filter((e) => !drop(e)));
  /** Shared handler shape: run, surface any thrown engine error. */
  const guarded = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err: unknown) {
      pushError(engineMessage(err));
    }
  };

  const applySources = useCallback((next: WorkspaceSourcesState) => {
    setSrc(next);
    setPreview(EMPTY_PREVIEW);
    setEngineErrors([]);
  }, []);

  // Persist Sources UI state for the *current* workspace only.
  // Do not depend on activeWsName — switching must not re-save the previous
  // files under the new name (race while awaiting getWorkspace).
  useEffect(() => {
    if (persistSkip.current) {
      persistSkip.current = false;
      return;
    }
    dispatch({
      type: "SET_WORKSPACE_FILES",
      name: activeNameRef.current,
      sources: src,
    });
  }, [src, dispatch]);

  // Load workspace summaries on mount
  useEffect(() => {
    let active = true;
    apiClient
      .listWorkspaceSummaries()
      .then((list) => {
        if (!active) return;
        setSummaries(list);
        setListError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setListError(engineMessage(err));
      });
    return () => {
      active = false;
    };
  }, []);

  const loadWorkspaceSources = useCallback(
    async (
      name: string,
      ws: Workspace | null,
      cache: Record<string, WorkspaceSourcesState>,
      gen: number,
    ) => {
      const stillCurrent = () =>
        gen === selectGenRef.current && activeNameRef.current === name;

      const cached = cache[name];
      const wsPaths = new Set<string>();
      if (ws?.datasets.train.x.path) wsPaths.add(ws.datasets.train.x.path);
      if (ws?.datasets.train.y?.path) wsPaths.add(ws.datasets.train.y.path);
      if (ws?.datasets.test?.x?.path) wsPaths.add(ws.datasets.test.x.path);
      for (const m of ws?.merges ?? []) wsPaths.add(m.source.path);

      const cacheMatchesWs =
        cached &&
        cached.files.length > 0 &&
        (wsPaths.size === 0 ||
          cached.files.some((f) => wsPaths.has(f.path) || wsPaths.has(f.spec.path)));

      if (cacheMatchesWs && cached) {
        if (!stillCurrent()) return;
        applySources(cached);
        return;
      }
      if (ws && ws.datasets.train.x.path) {
        const base = sourcesFromWorkspace(ws);
        try {
          const enriched = await Promise.all(
            base.files.map((f) => enrichFileItem(f)),
          );
          if (!stillCurrent()) return;
          const next = { ...base, files: enriched };
          applySources(next);
          dispatch({ type: "SET_WORKSPACE_FILES", name, sources: next });
        } catch (err: unknown) {
          if (!stillCurrent()) return;
          applySources(base);
          setEngineErrors([engineMessage(err)]);
        }
        return;
      }
      if (!stillCurrent()) return;
      if (name === "churn") {
        const churn = defaultChurnSources(FIXTURE_BASE);
        applySources(churn);
        dispatch({ type: "SET_WORKSPACE_FILES", name, sources: churn });
        return;
      }
      applySources(emptyWorkspaceSources());
      dispatch({
        type: "SET_WORKSPACE_FILES",
        name,
        sources: emptyWorkspaceSources(),
      });
    },
    [applySources, dispatch],
  );

  const handleSelectWorkspace = async (name: string) => {
    const previous = activeWsName;
    const previousSources = src;
    if (previous !== name) {
      dispatch({
        type: "SET_WORKSPACE_FILES",
        name: previous,
        sources: previousSources,
      });
    }
    const gen = ++selectGenRef.current;
    persistSkip.current = true;
    activeNameRef.current = name;
    setActiveWsName(name);
    setSourcesLoading(true);
    allowWorkspaceSave(name);
    // Clear immediately so previous workspace files cannot leak into the UI
    // or be re-persisted under the new name while we await the engine.
    applySources(emptyWorkspaceSources());

    const cacheAfterSave: Record<string, WorkspaceSourcesState> = {
      ...filesByWorkspace,
      ...(previous !== name ? { [previous]: previousSources } : {}),
    };

    try {
      const listed = summaries.some((w) => w.name === name);
      const onDisk =
        listed ||
        (await apiClient.listWorkspaceSummaries()).some((w) => w.name === name);
      if (gen !== selectGenRef.current) return;
      if (!onDisk) {
        dispatch({ type: "SET_WORKSPACE", workspace: emptyWorkspace(name) });
        rememberWorkspaceName(name);
        await loadWorkspaceSources(name, null, cacheAfterSave, gen);
        return;
      }
      const ws = await apiClient.getWorkspace(name);
      if (gen !== selectGenRef.current) return;
      dispatch({ type: "SET_WORKSPACE", workspace: ws });
      rememberWorkspaceName(name);
      await loadWorkspaceSources(name, ws, cacheAfterSave, gen);
    } catch (err: unknown) {
      if (gen !== selectGenRef.current) return;
      dispatch({ type: "SET_WORKSPACE", workspace: emptyWorkspace(name) });
      const msg = engineMessage(err);
      if (!/unknown workspace|not found/i.test(msg)) {
        setEngineErrors([msg]);
      }
      await loadWorkspaceSources(name, null, cacheAfterSave, gen);
    } finally {
      if (gen === selectGenRef.current) {
        setSourcesLoading(false);
      }
    }
  };

  const handleCreateWorkspace = (name: string) => {
    dispatch({
      type: "SET_WORKSPACE_FILES",
      name: activeWsName,
      sources: src,
    });
    allowWorkspaceSave(name);
    dispatch({ type: "SET_WORKSPACE", workspace: emptyWorkspace(name) });
    const empty = emptyWorkspaceSources();
    dispatch({ type: "SET_WORKSPACE_FILES", name, sources: empty });
    persistSkip.current = true;
    activeNameRef.current = name;
    setActiveWsName(name);
    applySources(empty);
    rememberWorkspaceName(name);
  };

  const handleWorkspaceRenamed = (oldName: string, ws: Workspace) => {
    // Invalidate any in-flight select of the old name (e.g. auto-select after
    // duplicate still loading when the user renames immediately).
    selectGenRef.current += 1;
    abandonPendingWorkspaceSave([oldName]);
    const cached = filesByWorkspace[oldName] ??
      (oldName === activeWsName ? src : null);
    dispatch({ type: "CLEAR_WORKSPACE_FILES", name: oldName });
    if (cached) {
      dispatch({
        type: "SET_WORKSPACE_FILES",
        name: ws.name,
        sources: cached,
      });
    }
    if (oldName === activeWsName || workspace?.name === oldName) {
      persistSkip.current = true;
      activeNameRef.current = ws.name;
      setActiveWsName(ws.name);
      allowWorkspaceSave(ws.name);
      dispatch({ type: "SET_WORKSPACE", workspace: ws });
      markWorkspaceSaved(ws);
      rememberWorkspaceName(ws.name);
      if (cached) applySources(cached);
    }
  };

  const handleWorkspaceDuplicated = (ws: Workspace) => {
    void handleSelectWorkspace(ws.name);
  };

  const handleActiveRemoved = (
    deletedNames: string[],
    fallback: string | null,
  ) => {
    abandonPendingWorkspaceSave(deletedNames);
    for (const name of deletedNames) {
      dispatch({ type: "CLEAR_WORKSPACE_FILES", name });
      forgetWorkspaceName(name);
    }
    const activeGone =
      deletedNames.includes(activeWsName) ||
      (workspace?.name != null && deletedNames.includes(workspace.name));
    if (!activeGone) return;

    dispatch({ type: "SET_WORKSPACE", workspace: null });
    persistSkip.current = true;
    if (fallback) {
      void handleSelectWorkspace(fallback);
    } else {
      activeNameRef.current = "";
      setActiveWsName("");
      applySources(emptyWorkspaceSources());
    }
  };

  const handleExportWorkspace = async (name: string) => {
    await guarded(async () => {
      if (name !== activeWsName) {
        await handleSelectWorkspace(name);
      }
      const ws = await apiClient.getWorkspace(name);
      abandonPendingWorkspaceSave();
      dispatch({ type: "SET_WORKSPACE", workspace: ws });
      markWorkspaceSaved(ws);
      rememberWorkspaceName(name);
      dispatch({ type: "SET_SCREEN", screen: "bench" });
      dispatch({ type: "SET_SHOW_EXPORT", show: true });
    });
  };

  // Build the workspace JSON candidate
  const buildResult = useMemo(() => {
    return buildWorkspaceJson({
      name: activeWsName,
      files,
      roles,
      labelMode,
      yJoin,
      targetCol,
      mergeKey,
      mergeInTest,
      steps: workspace?.steps ?? [],
    });
  }, [
    activeWsName,
    files,
    roles,
    labelMode,
    yJoin,
    targetCol,
    mergeKey,
    mergeInTest,
    workspace?.steps,
  ]);

  // Compute live preview shapes / columns and engine errors
  useEffect(() => {
    let active = true;
    const ws = buildResult.workspace;
    const patchPreview = (p: Partial<PreviewState>) =>
      setPreview((prev) => ({ ...prev, ...p }));

    if (buildResult.errors.length > 0) {
      setEngineErrors(buildResult.errors);
      patchPreview({ columns: null, target: null });
      return;
    }

    setEngineErrors([]);

    apiClient
      .previewWorkspace(ws, "train", 5)
      .then((res) => {
        if (!active) return;
        const trainX = files.find((f) => roles[f.id] === "trainX");
        const fromPreview = targetFromPreviewColumns(
          res.columns,
          trainX?.cols ?? [],
        );
        const fallback =
          labelMode === "yfile"
            ? yLabelValueColumn(
                files.find((f) => roles[f.id] === "trainY")?.cols ?? [],
              )
            : targetCol;
        const resolved = fromPreview ?? fallback ?? buildResult.targetLabel;
        patchPreview({ trainShape: res.shape, columns: res.columns, target: resolved });
        if (resolved) {
          dispatch({ type: "SET_TARGET_COLUMN", name: resolved });
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        patchPreview({ columns: null, target: buildResult.targetLabel });
        pushError(engineMessage(err));
      });

    if (ws.datasets.test?.x) {
      apiClient
        .previewWorkspace(ws, "test", 5)
        .then((res) => {
          if (active) patchPreview({ testShape: res.shape });
        })
        .catch((err: unknown) => {
          if (active) pushError(engineMessage(err));
        });
    } else {
      patchPreview({ testShape: null });
    }

    return () => {
      active = false;
    };
  }, [buildResult, dispatch, files, labelMode, roles, targetCol]);

  const handlePickRole = (fileId: string, role: FileRole) => {
    patch((s) => ({
      roles: { ...s.roles, [fileId]: role },
      guessedMap: { ...s.guessedMap, [fileId]: false },
    }));
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    if (!file) return;

    await guarded(async () => {
      const uploadRes = await apiClient.upload(file.name, file);
      const inspectRes = await apiClient.runKey("file_inspect", {
        path: uploadRes.path,
      });

      const mapped = mapFileInspect(inspectRes);
      if (mapped.error || !mapped.spec) {
        pushError(
          mapped.error ?? `Could not determine source kind for ${file.name}.`,
        );
        return;
      }

      const spec: FileSourceSpec = mapped.spec.path
        ? mapped.spec
        : { ...mapped.spec, path: uploadRes.path };

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
        pushError(
          remapped.error ?? `Could not determine source kind for ${file.name}.`,
        );
        return;
      }

      const id = `f_${Date.now()}`;
      const guessedRole = guessFileRole(file.name, roles);
      const finalSpec = remapped.spec.path ? remapped.spec : spec;
      const colCount = cols.length > 0 ? cols.length : (shape?.[1] ?? 0);

      const newItem: SourceFileItem = {
        id,
        name: file.name,
        path: uploadRes.path,
        cols,
        detected: remapped.detected,
        spec: finalSpec,
        rowCount: shape?.[0],
        isGuessed: true,
        sheets: remapped.sheets,
        recordPaths: remapped.recordPaths,
        // 0-byte files stay on the MAT-154 empty-train path even if the
        // engine also raises SourceError while reading them.
        parseError: file.size === 0 ? null : parseError,
      };

      patch((s) => ({
        files: [...s.files, newItem],
        roles: { ...s.roles, [id]: guessedRole },
        guessedMap: { ...s.guessedMap, [id]: true },
      }));
      // Open Options for kinds that often need a manual pick / override.
      if (
        finalSpec.kind === "excel" ||
        finalSpec.kind === "json" ||
        finalSpec.kind === "csv"
      ) {
        setOptionsOpen((prev) => ({ ...prev, [id]: true }));
      }

      // Truly empty (0-byte) or 0-column without a parse error → MAT-154 copy.
      // Unreadable non-empty files reuse the MAT-167 parse-error UI (MAT-169).
      if (file.size === 0 || (!parseError && colCount === 0)) {
        addError(EMPTY_TRAIN_MESSAGE);
      }
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSpecOptionsChange = (
    fileId: string,
    nextSpec: FileSourceSpec,
  ) => {
    const gen = (optionsGenRef.current[fileId] ?? 0) + 1;
    optionsGenRef.current[fileId] = gen;
    const current = files.find((f) => f.id === fileId);
    if (!current) return;
    const isLatest = () => optionsGenRef.current[fileId] === gen;
    setOptionsBusy((prev) => ({ ...prev, [fileId]: true }));
    const patchFile = (p: Partial<SourceFileItem>) =>
      patch((s) => ({
        files: s.files.map((f) => (f.id === fileId ? { ...f, ...p } : f)),
      }));
    patchFile({ spec: nextSpec, detected: formatDetectedFromSpec(nextSpec, null) });

    void (async () => {
      try {
        const { spec, cols, rowCount, detected, parseError } =
          await enrichFileItem({ ...current, spec: nextSpec });
        if (!isLatest()) return;
        patchFile({ spec, cols, rowCount, detected, parseError });
        if (!parseError && cols.length > 0) {
          dropErrors(
            (e) =>
              e.startsWith("Stored train source failed to parse:") ||
              e === EMPTY_TRAIN_MESSAGE ||
              (!!current.parseError && e === current.parseError),
          );
        } else if (parseError) {
          dropErrors(
            (e) =>
              e === EMPTY_TRAIN_MESSAGE ||
              (!!current.parseError && e === current.parseError),
          );
        }
      } catch (err: unknown) {
        if (isLatest()) pushError(engineMessage(err));
      } finally {
        if (isLatest()) setOptionsBusy((b) => ({ ...b, [fileId]: false }));
      }
    })();
  };

  const trainXFile = files.find((f) => roles[f.id] === "trainX");
  const trainYFile = files.find((f) => roles[f.id] === "trainY");
  const mergeFile = files.find((f) => roles[f.id] === "merge");

  const commonYCols =
    trainXFile && trainYFile
      ? getCommonColumns(trainXFile.cols, trainYFile.cols)
      : [];
  const commonMergeCols =
    trainXFile && mergeFile
      ? getCommonColumns(trainXFile.cols, mergeFile.cols)
      : [];
  /** Effective merge key: explicit pick, else first common column (matches build). */
  const effectiveMergeKey = mergeKey ?? commonMergeCols[0] ?? null;

  const resolvedTarget =
    preview.target ?? buildResult.targetLabel ?? null;

  const trainColumnCount =
    preview.trainShape != null
      ? preview.trainShape[1]
      : (trainXFile?.cols.length ?? 0);
  const trainHasPath = Boolean(trainXFile?.spec.path);
  const trainParseError = trainXFile?.parseError?.trim() || null;
  const trainReady =
    trainHasPath && trainColumnCount > 0 && !trainParseError;
  const canNavigate = !sourcesLoading && trainReady;
  const parseErrorHint = trainParseError
    ? trainParseErrorDisplay(trainParseError)
    : null;
  const emptyTrainHint =
    !sourcesLoading &&
    trainHasPath &&
    !trainParseError &&
    trainColumnCount === 0
      ? EMPTY_TRAIN_MESSAGE
      : sourcesLoading
        ? "Loading workspace sources…"
        : null;
  const navigateBlockReason = sourcesLoading
    ? "Loading workspace sources…"
    : parseErrorHint
      ? parseErrorHint
      : !trainReady
        ? EMPTY_TRAIN_MESSAGE
        : undefined;

  const openTrainOptions = () => {
    if (!trainXFile) return;
    setOptionsOpen((prev) => ({ ...prev, [trainXFile.id]: true }));
  };

  const handleReinspectTrain = async () => {
    if (!trainXFile?.spec.path && !trainXFile?.path) return;
    const path = trainXFile.spec.path || trainXFile.path;
    await guarded(async () => {
      const inspectRes = await apiClient.runKey("file_inspect", { path });
      const mapped = mapFileInspect(inspectRes);
      if (mapped.error || !mapped.spec) {
        pushError(mapped.error ?? `file_inspect failed for ${trainXFile.name}.`);
        return;
      }
      const nextSpec: FileSourceSpec = mapped.spec.path
        ? mapped.spec
        : { ...mapped.spec, path };
      const enriched = await enrichFileItem({
        ...trainXFile,
        path,
        spec: nextSpec,
        sheets: mapped.sheets,
        recordPaths: mapped.recordPaths,
        detected: mapped.detected,
        parseError: null,
        cols: [],
      });
      patch((s) => ({
        files: s.files.map((f) => (f.id === trainXFile.id ? enriched : f)),
      }));
      if (enriched.parseError) {
        pushError(storedSourceFailedMessage(enriched.parseError));
      } else {
        dropErrors(
          (e) =>
            e.startsWith("Stored train source failed to parse:") ||
            e === EMPTY_TRAIN_MESSAGE,
        );
      }
    });
  };

  const handleReplaceTrainFile = () => {
    if (trainXFile) {
      const { [trainXFile.id]: _role, ...restRoles } = roles;
      const { [trainXFile.id]: _guess, ...restGuessed } = guessedMap;
      patch((s) => ({
        files: s.files.filter((f) => f.id !== trainXFile.id),
        roles: restRoles,
        guessedMap: restGuessed,
      }));
    }
    fileInputRef.current?.click();
  };

  const handleSaveAndNavigate = async (screen: "align" | "bench") => {
    // Never PUT a workspace built from an unloaded / empty sources state (MAT-149).
    if (sourcesLoading) return;
    const trainPath = buildResult.workspace.datasets.train.x.path;
    if (!trainPath || trainColumnCount === 0 || trainParseError) {
      const msg = trainParseError
        ? trainParseErrorDisplay(trainParseError)
        : EMPTY_TRAIN_MESSAGE;
      addError(msg);
      return;
    }
    const ws = buildResult.workspace;
    dispatch({
      type: "SET_WORKSPACE_FILES",
      name: activeWsName,
      sources: src,
    });
    await guarded(async () => {
      await apiClient.saveWorkspace(ws);
      markWorkspaceSaved(ws);
      try {
        setSummaries(await apiClient.listWorkspaceSummaries());
      } catch {
        /* list refresh is best-effort after save */
      }
    });
    dispatch({ type: "SET_WORKSPACE", workspace: ws });
    if (resolvedTarget) {
      dispatch({ type: "SET_TARGET_COLUMN", name: resolvedTarget });
    }
    dispatch({ type: "SET_SCREEN", screen });
  };
  const trainShapeText = preview.trainShape
    ? `${preview.trainShape[0]} × ${preview.trainShape[1]}`
    : trainXFile
      ? `${trainXFile.rowCount ?? "—"} × ${
          trainXFile.cols.length +
          (labelMode === "yfile" && trainYFile
            ? yLabelValueColumn(trainYFile.cols)
              ? 1
              : 0
            : 0) +
          (mergeFile
            ? mergeFile.cols.filter((c) => c !== mergeKey).length
            : 0)
        }`
      : "—";

  const testFile = files.find((f) => roles[f.id] === "testX");
  const testShapeText = preview.testShape
    ? `${preview.testShape[0]} × ${preview.testShape[1]}`
    : testFile
      ? `${testFile.rowCount ?? "—"} × ${
          testFile.cols.length +
          (mergeInTest && mergeFile
            ? mergeFile.cols.filter((c) => c !== mergeKey).length
            : 0)
        }`
      : "—";

  // Prefer engine preview columns so Index from y is not duplicated and
  // only the real label column appears as target. Always union merge extras
  // once a merge key is chosen (MAT-155 item 5).
  const displayedCols = resultSchemaColumns({
    previewColumns: preview.columns,
    trainXCols: trainXFile?.cols ?? [],
    yCols: trainYFile?.cols ?? [],
    labelMode,
    mergeCols: mergeFile?.cols ?? [],
    mergeKey: effectiveMergeKey,
  });

  const originFor = (col: string): "x" | "y" | "merge" => {
    if (buildResult.originMap[col]) return buildResult.originMap[col]!;
    if (resolvedTarget && col === resolvedTarget) return "y";
    if (
      mergeFile?.cols.includes(col) &&
      col !== effectiveMergeKey
    ) {
      return "merge";
    }
    return "x";
  };

  const targetInfoText = (() => {
    if (buildResult.info.y) return buildResult.info.y;
    if (labelMode === "yfile" && !trainYFile) {
      return "No file has the role “Train y”.";
    }
    if (labelMode === "yfile" && resolvedTarget) {
      return `target = “${resolvedTarget}”`;
    }
    return "";
  })();

  return (
    <div className="sources-layout" aria-label="Sources screen">
      <WorkspaceSidebar
        summaries={summaries}
        activeName={activeWsName}
        listError={listError}
        onSelect={(name) => void handleSelectWorkspace(name)}
        onSummariesChange={setSummaries}
        onCreated={handleCreateWorkspace}
        onActiveRemoved={handleActiveRemoved}
        onRenamed={handleWorkspaceRenamed}
        onDuplicated={handleWorkspaceDuplicated}
        onExport={(name) => void handleExportWorkspace(name)}
        onError={addError}
      />

      <main className="sources-main">
        <div className="sources-header">
          <span className="sources-title">Sources of “{activeWsName}”</span>
          <span className="sources-subtitle">
            Roles were guessed from the file names. Check them: nothing is loaded
            until you continue.
          </span>
        </div>

        <section className="sources-card" aria-label="Files list">
          <div className="files-table-header">
            <span className="col-file">File</span>
            <span className="col-detected">Detected (file_inspect)</span>
            <span className="col-role">Role</span>
          </div>

          {files.map((fl) => {
            const currentRole = roles[fl.id] || "ignore";
            const isGuessed = guessedMap[fl.id];
            const optsOpen = Boolean(optionsOpen[fl.id]);
            const optsBusy = Boolean(optionsBusy[fl.id]);

            return (
              <div key={fl.id} className="files-table-block">
                <div className="files-table-row">
                  <div className="file-info">
                    <span className="file-name">{fl.name}</span>
                    <span className="file-cols" title={fl.cols.join(", ")}>
                      {fl.cols.join(", ")}
                    </span>
                  </div>

                  <div className="file-detected">
                    {fl.detected || formatDetectedFromSpec(fl.spec, null)}
                    <button
                      type="button"
                      className={`btn-file-options ${optsOpen ? "on" : ""}`}
                      aria-expanded={optsOpen}
                      aria-controls={`options-${fl.id}`}
                      onClick={() =>
                        setOptionsOpen((prev) => ({
                          ...prev,
                          [fl.id]: !prev[fl.id],
                        }))
                      }
                    >
                      Options
                    </button>
                  </div>

                  <div
                    className="file-roles"
                    role="group"
                    aria-label={`Role for ${fl.name}`}
                  >
                    {ALL_ROLES.map((r) => {
                      const isSelected = currentRole === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          className={`chip-role ${isSelected ? "on" : ""}`}
                          aria-pressed={isSelected}
                          onClick={() => handlePickRole(fl.id, r)}
                        >
                          {ROLE_LABELS[r]}
                          {isSelected && isGuessed ? (
                            <span
                              className="chip-guess-dot"
                              title="Guessed from file name"
                            >
                              (guess)
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {optsOpen ? (
                  <div
                    id={`options-${fl.id}`}
                    className="file-options-panel"
                    aria-label={`Load options for ${fl.name}`}
                  >
                    {optsBusy ? (
                      <span className="file-options-busy">Updating preview…</span>
                    ) : null}
                    <SourceOptionsEditor
                      file={fl}
                      busy={optsBusy}
                      onChange={(next) =>
                        void handleSpecOptionsChange(fl.id, next)
                      }
                    />
                  </div>
                ) : null}
              </div>
            );
          })}

          <div className="files-table-footer">
            <input
              id={fileInputId}
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              onChange={(e) => void handleFileUpload(e)}
            />
            <label
              htmlFor={fileInputId}
              className="btn-add-file"
              style={{ display: "inline-flex", alignItems: "center" }}
            >
              + Add a file (csv, parquet, excel, json)
            </label>
          </div>
        </section>

        <div className="two-col-grid">
          <section className="sources-card-padded" aria-label="Target settings">
            <div className="sources-card-title">Target</div>
            <div className="chips-row">
              <button
                type="button"
                className={`chip-select ${labelMode === "yfile" ? "on" : ""}`}
                aria-pressed={labelMode === "yfile"}
                onClick={() => patch(() => ({ labelMode: "yfile" }))}
              >
                Separate y file
              </button>
              <button
                type="button"
                className={`chip-select ${labelMode === "column" ? "on" : ""}`}
                aria-pressed={labelMode === "column"}
                onClick={() => patch(() => ({ labelMode: "column" }))}
              >
                Column in train X
              </button>
            </div>

            {labelMode === "yfile" ? (
              <>
                <div style={{ fontSize: "12px", color: "var(--dtk-muted)" }}>
                  Join y onto train X
                </div>
                <div className="chips-row">
                  <button
                    type="button"
                    className={`chip-select ${yJoin === "order" ? "on" : ""}`}
                    aria-pressed={yJoin === "order"}
                    onClick={() => patch(() => ({ yJoin: "order" }))}
                    title="y has one value column and the same row count"
                  >
                    By row order
                  </button>
                  <button
                    type="button"
                    className={`chip-select ${yJoin === "key" ? "on" : ""}`}
                    aria-pressed={yJoin === "key"}
                    disabled={commonYCols.length === 0}
                    onClick={() => patch(() => ({ yJoin: "key" }))}
                    title={
                      commonYCols.length === 0
                        ? `${trainYFile?.name || "y file"} has no column in common with train X`
                        : "Join by common key"
                    }
                  >
                    By key column
                  </button>
                </div>
                {resolvedTarget ? (
                  <div
                    style={{
                      fontSize: "12px",
                      fontFamily: "var(--dtk-font-mono)",
                      color: "var(--dtk-ink)",
                    }}
                  >
                    Label column: {resolvedTarget}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div style={{ fontSize: "12px", color: "var(--dtk-muted)" }}>
                  Which column of train X is the target?
                </div>
                <div className="chips-row">
                  {trainXFile?.cols.map((col) => {
                    const isSelected = targetCol === col;
                    return (
                      <button
                        key={col}
                        type="button"
                        className={`chip-mono ${isSelected ? "on" : ""}`}
                        aria-pressed={isSelected}
                        onClick={() => patch(() => ({ targetCol: col }))}
                      >
                        {col}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div
              className={`label-info ${resolvedTarget ? "success" : "error"}`}
            >
              {targetInfoText}
            </div>
          </section>

          <section className="sources-card-padded" aria-label="Merge settings">
            <div className="sources-card-title">Merge</div>
            {mergeFile ? (
              <>
                <div style={{ fontSize: "12px", color: "var(--dtk-muted)" }}>
                  Left join{" "}
                  <strong
                    style={{
                      fontFamily: "var(--dtk-font-mono)",
                      color: "var(--dtk-ink)",
                    }}
                  >
                    {mergeFile.name}
                  </strong>{" "}
                  on key
                </div>
                <div className="chips-row">
                  {commonMergeCols.map((col) => {
                    const isSelected = mergeKey === col;
                    return (
                      <button
                        key={col}
                        type="button"
                        className={`chip-mono ${isSelected ? "on" : ""}`}
                        aria-pressed={isSelected}
                        onClick={() => patch(() => ({ mergeKey: col }))}
                      >
                        {col}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    className={`chip-select ${mergeInTest ? "on" : ""}`}
                    aria-pressed={mergeInTest}
                    onClick={() => patch(() => ({ mergeInTest: !mergeInTest }))}
                  >
                    Also merge into test: {mergeInTest ? "yes" : "no"}
                  </button>
                </div>
                <div className="label-info success">{buildResult.info.merge}</div>
              </>
            ) : (
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--dtk-muted)",
                  lineHeight: 1.5,
                }}
              >
                Give a file the role “Merge” to join extra columns (one row per
                key) onto train and test.
              </div>
            )}
          </section>
        </div>

        <section className="sources-card-padded" aria-label="Result schema">
          <div className="res-header">
            <span className="sources-card-title">Result</span>
            <span className="res-shape">
              train {trainShapeText} · test {testShapeText}
            </span>
          </div>

          <div className="chips-row">
            {displayedCols.map((col) => {
              const origin = originFor(col);
              const isTarget = col === resolvedTarget;
              return (
                <span key={col} className={`res-col-chip origin-${origin}`}>
                  {col}
                  {isTarget ? " ◎" : ""}
                </span>
              );
            })}
          </div>

          <div className="res-legend">
            <span className="legend-x">■ X</span>
            <span className="legend-y">■ y (label)</span>
            <span className="legend-merge">■ merged</span>
          </div>

          {engineErrors
            .filter(
              (err) =>
                err !== emptyTrainHint &&
                err !== parseErrorHint &&
                !(trainParseError && err === trainParseError),
            )
            .map((err, i) => (
              <div key={i} className="engine-error-box" role="alert">
                {err}
              </div>
            ))}
          {parseErrorHint ? (
            <div
              className="engine-error-box"
              role="alert"
              data-train-parse-error="1"
            >
              {parseErrorHint}
            </div>
          ) : null}
          {emptyTrainHint &&
          emptyTrainHint !== parseErrorHint &&
          !engineErrors.includes(emptyTrainHint) ? (
            <div className="engine-error-box" role="status">
              {emptyTrainHint}
            </div>
          ) : null}
          {parseErrorHint ? (
            <div className="sources-recovery-actions" role="group">
              <button
                type="button"
                className="btn-outline-action"
                data-reinspect-train="1"
                onClick={() => void handleReinspectTrain()}
              >
                Re-inspect
              </button>
              {trainXFile?.spec.kind === "csv" ? (
                <button
                  type="button"
                  className="btn-outline-action"
                  data-open-train-options="1"
                  onClick={openTrainOptions}
                >
                  Options (on_bad_lines)
                </button>
              ) : null}
              <button
                type="button"
                className="btn-outline-action"
                data-replace-train="1"
                onClick={handleReplaceTrainFile}
              >
                Replace file
              </button>
            </div>
          ) : null}
        </section>

        <div className="sources-actions">
          <button
            type="button"
            className="btn-primary-action"
            disabled={!canNavigate}
            title={navigateBlockReason}
            onClick={() => void handleSaveAndNavigate("align")}
          >
            Check train / test alignment →
          </button>
          <button
            type="button"
            className="btn-secondary-action"
            disabled={!canNavigate}
            title={navigateBlockReason}
            onClick={() => void handleSaveAndNavigate("bench")}
          >
            Open workbench
          </button>
        </div>
      </main>
    </div>
  );
}
