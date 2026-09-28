import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { rememberWorkspaceName } from "../../bootstrap";
import { apiClient } from "../../api/client";
import type { EngineError, FileSourceSpec, Workspace } from "../../api/types";
import { useAppDispatch, useAppState, markWorkspaceSaved } from "../../state/AppStore";
import {
  ALL_ROLES,
  buildWorkspaceJson,
  defaultChurnSources,
  emptyWorkspaceSources,
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
import { SourceOptionsEditor } from "./SourceOptionsEditor";
import "./sources.css";

const FIXTURE_BASE =
  "/home/matleniz/wt-datatoolkit-web/fxa-sources/e2e/fixtures";

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

function engineMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as Partial<EngineError>;
    const msg = typeof e.message === "string" ? e.message : "";
    const typ = typeof e.type === "string" ? e.type : "";
    if (typ && msg) return `${typ}: ${msg}`;
    if (msg) return msg;
  }
  return String(err);
}

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
    const mini: Workspace = {
      name: "inspect",
      datasets: { train: { x: spec } },
      label: { mode: "order" },
      merges: [],
      variables: [],
      steps: [],
    };
    const preview = await apiClient.previewWorkspace(mini, "train", 1);
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

  const [workspacesList, setWorkspacesList] = useState<Workspace[]>([]);
  const [activeWsName, setActiveWsName] = useState<string>(
    workspace?.name ?? "churn",
  );
  const [showNewWsInput, setShowNewWsInput] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [listError, setListError] = useState<string | null>(null);

  const initialSources = useMemo((): WorkspaceSourcesState => {
    const cached = filesByWorkspace[activeWsName];
    if (cached) return cached;
    if (activeWsName === "churn") return defaultChurnSources(FIXTURE_BASE);
    return emptyWorkspaceSources();
  }, [activeWsName, filesByWorkspace]);

  const [files, setFiles] = useState<SourceFileItem[]>(initialSources.files);
  const [roles, setRoles] = useState<Record<string, FileRole>>(
    initialSources.roles,
  );
  const [guessedMap, setGuessedMap] = useState<Record<string, boolean>>(
    initialSources.guessedMap,
  );
  const [labelMode, setLabelMode] = useState<"yfile" | "column">(
    initialSources.labelMode,
  );
  const [yJoin, setYJoin] = useState<"order" | "key">(initialSources.yJoin);
  const [targetCol, setTargetCol] = useState<string | null>(
    initialSources.targetCol,
  );
  const [mergeKey, setMergeKey] = useState<string | null>(
    initialSources.mergeKey,
  );
  const [mergeInTest, setMergeInTest] = useState<boolean>(
    initialSources.mergeInTest,
  );

  const [trainPreviewShape, setTrainPreviewShape] = useState<
    [number, number] | null
  >(null);
  const [testPreviewShape, setTestPreviewShape] = useState<
    [number, number] | null
  >(null);
  const [previewColumns, setPreviewColumns] = useState<string[] | null>(null);
  const [engineTarget, setEngineTarget] = useState<string | null>(null);
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

  const currentSources = useCallback((): WorkspaceSourcesState => {
    return {
      files,
      roles,
      guessedMap,
      labelMode,
      yJoin,
      targetCol,
      mergeKey,
      mergeInTest,
    };
  }, [
    files,
    roles,
    guessedMap,
    labelMode,
    yJoin,
    targetCol,
    mergeKey,
    mergeInTest,
  ]);

  const applySources = useCallback((src: WorkspaceSourcesState) => {
    setFiles(src.files);
    setRoles(src.roles);
    setGuessedMap(src.guessedMap);
    setLabelMode(src.labelMode);
    setYJoin(src.yJoin);
    setTargetCol(src.targetCol);
    setMergeKey(src.mergeKey);
    setMergeInTest(src.mergeInTest);
    setTrainPreviewShape(null);
    setTestPreviewShape(null);
    setPreviewColumns(null);
    setEngineTarget(null);
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
      sources: {
        files,
        roles,
        guessedMap,
        labelMode,
        yJoin,
        targetCol,
        mergeKey,
        mergeInTest,
      },
    });
  }, [
    files,
    roles,
    guessedMap,
    labelMode,
    yJoin,
    targetCol,
    mergeKey,
    mergeInTest,
    dispatch,
  ]);

  // Load workspaces on mount
  useEffect(() => {
    let active = true;
    apiClient
      .listWorkspaces()
      .then((list) => {
        if (!active) return;
        setWorkspacesList(list);
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
    const previousSources = currentSources();
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
    // Clear immediately so previous workspace files cannot leak into the UI
    // or be re-persisted under the new name while we await the engine.
    applySources(emptyWorkspaceSources());

    const cacheAfterSave: Record<string, WorkspaceSourcesState> = {
      ...filesByWorkspace,
      ...(previous !== name ? { [previous]: previousSources } : {}),
    };

    try {
      const listed = workspacesList.some((w) => w.name === name);
      const onDisk =
        listed ||
        (await apiClient.listWorkspaces()).some((w) => w.name === name);
      if (gen !== selectGenRef.current) return;
      if (!onDisk) {
        const empty: Workspace = {
          name,
          datasets: {
            train: { x: { kind: "csv", path: "" } },
          },
          label: { mode: "order" },
          merges: [],
          variables: [],
          steps: [],
        };
        dispatch({ type: "SET_WORKSPACE", workspace: empty });
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
      const empty: Workspace = {
        name,
        datasets: {
          train: { x: { kind: "csv", path: "" } },
        },
        label: { mode: "order" },
        merges: [],
        variables: [],
        steps: [],
      };
      dispatch({ type: "SET_WORKSPACE", workspace: empty });
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

  const handleCreateWorkspace = async () => {
    const trimmed = newWsName.trim();
    if (!trimmed) return;
    dispatch({
      type: "SET_WORKSPACE_FILES",
      name: activeWsName,
      sources: currentSources(),
    });
    const ws: Workspace = {
      name: trimmed,
      datasets: {
        train: { x: { kind: "csv", path: "" } },
      },
      label: { mode: "order" },
      merges: [],
      variables: [],
      steps: [],
    };
    try {
      await apiClient.saveWorkspace(ws);
      setWorkspacesList((prev) => [
        ...prev.filter((w) => w.name !== trimmed),
        ws,
      ]);
      setListError(null);
    } catch (err: unknown) {
      setEngineErrors([engineMessage(err)]);
    }
    dispatch({ type: "SET_WORKSPACE", workspace: ws });
    const empty = emptyWorkspaceSources();
    dispatch({ type: "SET_WORKSPACE_FILES", name: trimmed, sources: empty });
    persistSkip.current = true;
    activeNameRef.current = trimmed;
    setActiveWsName(trimmed);
    applySources(empty);
    setShowNewWsInput(false);
    setNewWsName("");
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

    if (buildResult.errors.length > 0) {
      setEngineErrors(buildResult.errors);
      setPreviewColumns(null);
      setEngineTarget(null);
      return;
    }

    setEngineErrors([]);

    apiClient
      .previewWorkspace(ws, "train", 5)
      .then((res) => {
        if (!active) return;
        setTrainPreviewShape(res.shape);
        setPreviewColumns(res.columns);
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
        setEngineTarget(resolved);
        if (resolved) {
          dispatch({ type: "SET_TARGET_COLUMN", name: resolved });
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPreviewColumns(null);
        setEngineTarget(buildResult.targetLabel);
        setEngineErrors((prev) => [...prev, engineMessage(err)]);
      });

    if (ws.datasets.test?.x) {
      apiClient
        .previewWorkspace(ws, "test", 5)
        .then((res) => {
          if (!active) return;
          setTestPreviewShape(res.shape);
        })
        .catch((err: unknown) => {
          if (!active) return;
          setEngineErrors((prev) => [...prev, engineMessage(err)]);
        });
    } else {
      setTestPreviewShape(null);
    }

    return () => {
      active = false;
    };
  }, [buildResult, dispatch, files, labelMode, roles, targetCol]);

  const handlePickRole = (fileId: string, role: FileRole) => {
    setRoles((prev) => ({ ...prev, [fileId]: role }));
    setGuessedMap((prev) => ({ ...prev, [fileId]: false }));
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    if (!file) return;

    try {
      const uploadRes = await apiClient.upload(file.name, file);
      const inspectRes = await apiClient.runKey("file_inspect", {
        path: uploadRes.path,
      });

      const mapped = mapFileInspect(inspectRes);
      if (mapped.error || !mapped.spec) {
        setEngineErrors((prev) => [
          ...prev,
          mapped.error ??
            `Could not determine source kind for ${file.name}.`,
        ]);
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
        const mini: Workspace = {
          name: "inspect",
          datasets: { train: { x: spec } },
          label: { mode: "order" },
          merges: [],
          variables: [],
          steps: [],
        };
        const preview = await apiClient.previewWorkspace(mini, "train", 1);
        shape = preview.shape;
      } catch (err: unknown) {
        if (!parseError) parseError = engineMessage(err);
      }

      const remapped = mapFileInspect(inspectRes, shape);
      if (remapped.error || !remapped.spec) {
        setEngineErrors((prev) => [
          ...prev,
          remapped.error ??
            `Could not determine source kind for ${file.name}.`,
        ]);
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

      setFiles((prev) => [...prev, newItem]);
      setRoles((prev) => ({ ...prev, [id]: guessedRole }));
      setGuessedMap((prev) => ({ ...prev, [id]: true }));
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
        setEngineErrors((prev) =>
          prev.includes(EMPTY_TRAIN_MESSAGE)
            ? prev
            : [...prev, EMPTY_TRAIN_MESSAGE],
        );
      }
    } catch (err: unknown) {
      setEngineErrors((prev) => [...prev, engineMessage(err)]);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSpecOptionsChange = (
    fileId: string,
    nextSpec: FileSourceSpec,
  ) => {
    const gen = (optionsGenRef.current[fileId] ?? 0) + 1;
    optionsGenRef.current[fileId] = gen;
    setOptionsBusy((prev) => ({ ...prev, [fileId]: true }));

    setFiles((prev) => {
      const current = prev.find((f) => f.id === fileId);
      if (!current) {
        setOptionsBusy((b) => ({ ...b, [fileId]: false }));
        return prev;
      }

      void (async () => {
        try {
          const enriched = await enrichFileItem({ ...current, spec: nextSpec });
          if (optionsGenRef.current[fileId] !== gen) return;
          setFiles((latest) =>
            latest.map((f) =>
              f.id === fileId
                ? {
                    ...f,
                    spec: enriched.spec,
                    cols: enriched.cols,
                    rowCount: enriched.rowCount,
                    detected: enriched.detected,
                    parseError: enriched.parseError,
                  }
                : f,
            ),
          );
          if (!enriched.parseError && enriched.cols.length > 0) {
            setEngineErrors((prev) =>
              prev.filter(
                (e) =>
                  !e.startsWith("Stored train source failed to parse:") &&
                  e !== EMPTY_TRAIN_MESSAGE &&
                  !(current.parseError && e === current.parseError),
              ),
            );
          } else if (enriched.parseError) {
            setEngineErrors((prev) =>
              prev.filter(
                (e) =>
                  e !== EMPTY_TRAIN_MESSAGE &&
                  !(current.parseError && e === current.parseError),
              ),
            );
          }
        } catch (err: unknown) {
          if (optionsGenRef.current[fileId] !== gen) return;
          setEngineErrors((errs) => [...errs, engineMessage(err)]);
        } finally {
          if (optionsGenRef.current[fileId] === gen) {
            setOptionsBusy((b) => ({ ...b, [fileId]: false }));
          }
        }
      })();

      return prev.map((f) =>
        f.id === fileId
          ? {
              ...f,
              spec: nextSpec,
              detected: formatDetectedFromSpec(nextSpec, null),
            }
          : f,
      );
    });
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
    engineTarget ?? buildResult.targetLabel ?? null;

  const trainColumnCount =
    trainPreviewShape != null
      ? trainPreviewShape[1]
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
    try {
      const inspectRes = await apiClient.runKey("file_inspect", { path });
      const mapped = mapFileInspect(inspectRes);
      if (mapped.error || !mapped.spec) {
        setEngineErrors((prev) => [
          ...prev,
          mapped.error ?? `file_inspect failed for ${trainXFile.name}.`,
        ]);
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
      setFiles((prev) =>
        prev.map((f) => (f.id === trainXFile.id ? enriched : f)),
      );
      if (enriched.parseError) {
        setEngineErrors((prev) => [
          ...prev,
          storedSourceFailedMessage(enriched.parseError!),
        ]);
      } else {
        setEngineErrors((prev) =>
          prev.filter(
            (e) =>
              !e.startsWith("Stored train source failed to parse:") &&
              e !== EMPTY_TRAIN_MESSAGE,
          ),
        );
      }
    } catch (err: unknown) {
      setEngineErrors((prev) => [...prev, engineMessage(err)]);
    }
  };

  const handleReplaceTrainFile = () => {
    if (trainXFile) {
      setFiles((prev) => prev.filter((f) => f.id !== trainXFile.id));
      setRoles((prev) => {
        const next = { ...prev };
        delete next[trainXFile.id];
        return next;
      });
      setGuessedMap((prev) => {
        const next = { ...prev };
        delete next[trainXFile.id];
        return next;
      });
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
      setEngineErrors((prev) => (prev.includes(msg) ? prev : [...prev, msg]));
      return;
    }
    const ws = buildResult.workspace;
    dispatch({
      type: "SET_WORKSPACE_FILES",
      name: activeWsName,
      sources: currentSources(),
    });
    try {
      await apiClient.saveWorkspace(ws);
      markWorkspaceSaved(ws);
      setWorkspacesList((prev) => [
        ...prev.filter((w) => w.name !== ws.name),
        ws,
      ]);
    } catch (err: unknown) {
      setEngineErrors((prev) => [...prev, engineMessage(err)]);
    }
    dispatch({ type: "SET_WORKSPACE", workspace: ws });
    if (resolvedTarget) {
      dispatch({ type: "SET_TARGET_COLUMN", name: resolvedTarget });
    }
    dispatch({ type: "SET_SCREEN", screen });
  };
  const trainShapeText = trainPreviewShape
    ? `${trainPreviewShape[0]} × ${trainPreviewShape[1]}`
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
  const testShapeText = testPreviewShape
    ? `${testPreviewShape[0]} × ${testPreviewShape[1]}`
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
    previewColumns,
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

  const fileCountFor = (name: string): number => {
    const cached = filesByWorkspace[name];
    if (cached) return cached.files.length;
    if (name === activeWsName) return files.length;
    const ws = workspacesList.find((w) => w.name === name);
    if (!ws) return 0;
    let n = 0;
    if (ws.datasets.train.x.path) n += 1;
    if (ws.datasets.train.y?.path) n += 1;
    if (ws.datasets.test?.x?.path) n += 1;
    n += ws.merges?.length ?? 0;
    return n;
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
      <aside className="sources-sidebar" aria-label="Workspaces">
        <div className="sources-sidebar-title">Workspaces</div>
        <div className="sources-sidebar-desc">
          A workspace = which files make train and test, how the label joins, and
          the ordered log of steps.
        </div>

        {listError ? (
          <div className="engine-error-box" role="alert">
            {listError}
          </div>
        ) : null}

        {workspacesList.map((ws) => {
          const isActive = ws.name === activeWsName;
          const nFiles = fileCountFor(ws.name);
          return (
            <button
              key={ws.name}
              type="button"
              className={`ws-item ${isActive ? "active" : ""}`}
              onClick={() => void handleSelectWorkspace(ws.name)}
              aria-current={isActive ? "true" : undefined}
            >
              <span className="ws-item-name">{ws.name}</span>
              <span className="ws-item-meta">
                {nFiles} file{nFiles === 1 ? "" : "s"} · {ws.steps.length} steps
                {isActive ? " · open" : ""}
              </span>
            </button>
          );
        })}

        {workspacesList.length === 0 && (
          <>
            <button
              type="button"
              className={`ws-item ${activeWsName === "churn" ? "active" : ""}`}
              onClick={() => void handleSelectWorkspace("churn")}
            >
              <span className="ws-item-name">churn</span>
              <span className="ws-item-meta">
                {fileCountFor("churn")} files · 0 steps · open
              </span>
            </button>
            <button
              type="button"
              className={`ws-item ${activeWsName === "parkinson" ? "active" : ""}`}
              onClick={() => void handleSelectWorkspace("parkinson")}
            >
              <span className="ws-item-name">parkinson</span>
              <span className="ws-item-meta">
                {fileCountFor("parkinson")} files · 0 steps
              </span>
            </button>
          </>
        )}

        {showNewWsInput ? (
          <div className="new-ws-form">
            <input
              type="text"
              className="new-ws-input"
              placeholder="Workspace name"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              autoFocus
            />
            <div className="new-ws-actions">
              <button
                type="button"
                className="new-ws-create"
                onClick={() => void handleCreateWorkspace()}
              >
                Create
              </button>
              <button
                type="button"
                className="new-ws-cancel"
                onClick={() => setShowNewWsInput(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn-new-ws"
            onClick={() => setShowNewWsInput(true)}
          >
            + New workspace
          </button>
        )}
      </aside>

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
                onClick={() => setLabelMode("yfile")}
              >
                Separate y file
              </button>
              <button
                type="button"
                className={`chip-select ${labelMode === "column" ? "on" : ""}`}
                aria-pressed={labelMode === "column"}
                onClick={() => setLabelMode("column")}
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
                    onClick={() => setYJoin("order")}
                    title="y has one value column and the same row count"
                  >
                    By row order
                  </button>
                  <button
                    type="button"
                    className={`chip-select ${yJoin === "key" ? "on" : ""}`}
                    aria-pressed={yJoin === "key"}
                    disabled={commonYCols.length === 0}
                    onClick={() => setYJoin("key")}
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
                        onClick={() => setTargetCol(col)}
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
                        onClick={() => setMergeKey(col)}
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
                    onClick={() => setMergeInTest(!mergeInTest)}
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
