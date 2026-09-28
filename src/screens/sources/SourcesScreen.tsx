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
import type { EngineError, Workspace } from "../../api/types";
import { useAppDispatch, useAppState, markWorkspaceSaved } from "../../state/AppStore";
import {
  ALL_ROLES,
  buildWorkspaceJson,
  defaultChurnSources,
  emptyWorkspaceSources,
  extractFilesFromWorkspace,
  getCommonColumns,
  guessFileRole,
  mapFileInspect,
  ROLE_LABELS,
  targetFromPreviewColumns,
  yLabelValueColumn,
  type FileRole,
  type SourceFileItem,
  type WorkspaceSourcesState,
} from "./sourcesLogic";
import "./sources.css";

const FIXTURE_BASE =
  "/home/matleniz/wt-datatoolkit-web/fxa-sources/e2e/fixtures";

/** Shown when train has 0 columns / empty file (MAT-154). */
const EMPTY_TRAIN_MESSAGE =
  "This train file has no columns (empty or unreadable). Replace it before opening the workbench or checking alignment.";

function engineMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as EngineError).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return String(err);
}

async function enrichFileItem(item: SourceFileItem): Promise<SourceFileItem> {
  let cols = item.cols;
  let rowCount = item.rowCount;
  let detected = item.detected;
  const spec = item.spec;

  try {
    const colList = await apiClient.sourceColumns(spec);
    cols = colList.map((c) => c.name);
  } catch {
    /* keep existing cols */
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
    detected =
      detected && detected.includes("×")
        ? detected.replace(/\d+\s*×\s*\d+/, `${preview.shape[0]} × ${preview.shape[1]}`)
        : mapFileInspect(
            {
              metrics: {
                delimiter: "','",
                encoding_guess: "utf-8",
                load_spec: JSON.stringify(spec),
              },
              tables: [],
              figures: [],
              text: "",
            },
            preview.shape,
          ).detected;
  } catch {
    /* keep existing rowCount / detected */
  }

  return { ...item, cols, rowCount, detected, spec };
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
      const spec = mapped.spec.path
        ? mapped.spec
        : { ...mapped.spec, path: uploadRes.path };

      let cols: string[] = [];
      try {
        const colList = await apiClient.sourceColumns(spec);
        cols = colList.map((c) => c.name);
      } catch (err: unknown) {
        setEngineErrors((prev) => [...prev, engineMessage(err)]);
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
        setEngineErrors((prev) => [...prev, engineMessage(err)]);
      }

      const remapped = mapFileInspect(inspectRes, shape);
      const id = `f_${Date.now()}`;
      const guessedRole = guessFileRole(file.name, roles);
      const colCount = cols.length > 0 ? cols.length : (shape?.[1] ?? 0);

      const newItem: SourceFileItem = {
        id,
        name: file.name,
        path: uploadRes.path,
        cols,
        detected: remapped.detected,
        spec: remapped.spec.path ? remapped.spec : spec,
        rowCount: shape?.[0],
        isGuessed: true,
      };

      setFiles((prev) => [...prev, newItem]);
      setRoles((prev) => ({ ...prev, [id]: guessedRole }));
      setGuessedMap((prev) => ({ ...prev, [id]: true }));

      if (colCount === 0 || file.size === 0) {
        setEngineErrors((prev) => [...prev, EMPTY_TRAIN_MESSAGE]);
      }
    } catch (err: unknown) {
      setEngineErrors((prev) => [...prev, engineMessage(err)]);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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

  const resolvedTarget =
    engineTarget ?? buildResult.targetLabel ?? null;

  const trainColumnCount =
    trainPreviewShape != null
      ? trainPreviewShape[1]
      : (trainXFile?.cols.length ?? 0);
  const trainHasPath = Boolean(trainXFile?.spec.path);
  const trainReady = trainHasPath && trainColumnCount > 0;
  const canNavigate = !sourcesLoading && trainReady;
  const emptyTrainHint =
    !sourcesLoading && trainHasPath && trainColumnCount === 0
      ? EMPTY_TRAIN_MESSAGE
      : sourcesLoading
        ? "Loading workspace sources…"
        : null;

  const handleSaveAndNavigate = async (screen: "align" | "bench") => {
    // Never PUT a workspace built from an unloaded / empty sources state (MAT-149).
    if (sourcesLoading) return;
    const trainPath = buildResult.workspace.datasets.train.x.path;
    if (!trainPath || trainColumnCount === 0) {
      setEngineErrors((prev) =>
        prev.includes(EMPTY_TRAIN_MESSAGE)
          ? prev
          : [...prev, EMPTY_TRAIN_MESSAGE],
      );
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
  // only the real label column appears as target.
  const displayedCols =
    previewColumns ??
    (trainXFile
      ? [
          ...trainXFile.cols,
          ...(trainYFile && labelMode === "yfile"
            ? (() => {
                const v = yLabelValueColumn(trainYFile.cols);
                return v && !trainXFile.cols.includes(v) ? [v] : [];
              })()
            : []),
          ...(mergeFile
            ? mergeFile.cols.filter((c) => c !== mergeKey)
            : []),
        ]
      : []);

  const originFor = (col: string): "x" | "y" | "merge" => {
    if (buildResult.originMap[col]) return buildResult.originMap[col]!;
    if (resolvedTarget && col === resolvedTarget) return "y";
    if (mergeFile?.cols.includes(col) && col !== mergeKey) return "merge";
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

            return (
              <div key={fl.id} className="files-table-row">
                <div className="file-info">
                  <span className="file-name">{fl.name}</span>
                  <span className="file-cols" title={fl.cols.join(", ")}>
                    {fl.cols.join(", ")}
                  </span>
                </div>

                <div className="file-detected">
                  {fl.detected || 'csv · sep "," · utf-8 · header 0'}
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
              + Add a file (csv, parquet, excel, json, sql query)
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

          {engineErrors.map((err, i) => (
            <div key={i} className="engine-error-box" role="alert">
              {err}
            </div>
          ))}
          {emptyTrainHint &&
          !engineErrors.includes(emptyTrainHint) ? (
            <div className="engine-error-box" role="status">
              {emptyTrainHint}
            </div>
          ) : null}
        </section>

        <div className="sources-actions">
          <button
            type="button"
            className="btn-primary-action"
            disabled={!canNavigate}
            title={
              sourcesLoading
                ? "Loading workspace sources…"
                : !trainReady
                  ? EMPTY_TRAIN_MESSAGE
                  : undefined
            }
            onClick={() => void handleSaveAndNavigate("align")}
          >
            Check train / test alignment →
          </button>
          <button
            type="button"
            className="btn-secondary-action"
            disabled={!canNavigate}
            title={
              sourcesLoading
                ? "Loading workspace sources…"
                : !trainReady
                  ? EMPTY_TRAIN_MESSAGE
                  : undefined
            }
            onClick={() => void handleSaveAndNavigate("bench")}
          >
            Open workbench
          </button>
        </div>
      </main>
    </div>
  );
}
