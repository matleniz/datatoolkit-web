import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { apiClient } from "../../api/client";
import type {
  CsvSource,
  EngineError,
  FileSourceSpec,
  Workspace,
} from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import {
  ALL_ROLES,
  buildWorkspaceJson,
  formatDetected,
  getCommonColumns,
  guessFileRole,
  ROLE_LABELS,
  type FileRole,
  type SourceFileItem,
} from "./sourcesLogic";
import "./sources.css";

const DEFAULT_CHURN_FILES: SourceFileItem[] = [
  {
    id: "train",
    name: "churn_train.csv",
    path: "/home/matleniz/wt-datatoolkit-web/w1-sources-align/e2e/fixtures/churn_train.csv",
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
    spec: {
      kind: "csv",
      path: "/home/matleniz/wt-datatoolkit-web/w1-sources-align/e2e/fixtures/churn_train.csv",
    },
    rowCount: 20,
    isGuessed: true,
  },
  {
    id: "labels",
    name: "churn_labels.csv",
    path: "/home/matleniz/wt-datatoolkit-web/w1-sources-align/e2e/fixtures/churn_labels.csv",
    cols: ["churn"],
    detected: 'csv · sep "," · utf-8 · header 0 · 20 × 1',
    spec: {
      kind: "csv",
      path: "/home/matleniz/wt-datatoolkit-web/w1-sources-align/e2e/fixtures/churn_labels.csv",
    },
    rowCount: 20,
    isGuessed: true,
  },
  {
    id: "test",
    name: "churn_test.csv",
    path: "/home/matleniz/wt-datatoolkit-web/w1-sources-align/e2e/fixtures/churn_test.csv",
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
      path: "/home/matleniz/wt-datatoolkit-web/w1-sources-align/e2e/fixtures/churn_test.csv",
    },
    rowCount: 6,
    isGuessed: true,
  },
  {
    id: "extra",
    name: "customers_extra.csv",
    path: "/home/matleniz/wt-datatoolkit-web/w1-sources-align/e2e/fixtures/customers_extra.csv",
    cols: ["customer_id", "region"],
    detected: 'csv · sep "," · utf-8 · header 0 · 26 × 2',
    spec: {
      kind: "csv",
      path: "/home/matleniz/wt-datatoolkit-web/w1-sources-align/e2e/fixtures/customers_extra.csv",
    },
    rowCount: 26,
    isGuessed: true,
  },
];

export function SourcesScreen() {
  const { workspace } = useAppState();
  const dispatch = useAppDispatch();
  const fileInputId = useId();

  const [workspacesList, setWorkspacesList] = useState<Workspace[]>([]);
  const [activeWsName, setActiveWsName] = useState<string>(
    workspace?.name ?? "churn",
  );
  const [showNewWsInput, setShowNewWsInput] = useState(false);
  const [newWsName, setNewWsName] = useState("");

  const [files, setFiles] = useState<SourceFileItem[]>(() => {
    return DEFAULT_CHURN_FILES;
  });

  const [roles, setRoles] = useState<Record<string, FileRole>>(() => {
    const r: Record<string, FileRole> = {};
    for (const f of DEFAULT_CHURN_FILES) {
      r[f.id] = guessFileRole(f.name, r);
    }
    return r;
  });

  const [guessedMap, setGuessedMap] = useState<Record<string, boolean>>(() => {
    const g: Record<string, boolean> = {};
    for (const f of DEFAULT_CHURN_FILES) {
      g[f.id] = true;
    }
    return g;
  });

  const [labelMode, setLabelMode] = useState<"yfile" | "column">("yfile");
  const [yJoin, setYJoin] = useState<"order" | "key">("order");
  const [targetCol, setTargetCol] = useState<string | null>(null);
  const [mergeKey, setMergeKey] = useState<string | null>("customer_id");
  const [mergeInTest, setMergeInTest] = useState<boolean>(true);

  const [trainPreviewShape, setTrainPreviewShape] = useState<[number, number] | null>(null);
  const [testPreviewShape, setTestPreviewShape] = useState<[number, number] | null>(null);
  const [engineErrors, setEngineErrors] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load workspaces on mount
  useEffect(() => {
    let active = true;
    apiClient
      .listWorkspaces()
      .then((list) => {
        if (!active) return;
        setWorkspacesList(list);
      })
      .catch(() => {
        // Fallback in case endpoint is unavailable
      });
    return () => {
      active = false;
    };
  }, []);

  // Sync workspace if activeWsName matches
  const handleSelectWorkspace = async (name: string) => {
    setActiveWsName(name);
    try {
      const ws = await apiClient.getWorkspace(name);
      dispatch({ type: "SET_WORKSPACE", workspace: ws });
    } catch {
      // Create empty if not found
      dispatch({
        type: "SET_WORKSPACE",
        workspace: {
          name,
          datasets: {
            train: { x: { kind: "csv", path: "" } },
          },
          label: { mode: "order" },
          merges: [],
          variables: [],
          steps: [],
        },
      });
    }
  };

  const handleCreateWorkspace = async () => {
    const trimmed = newWsName.trim();
    if (!trimmed) return;
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
      setWorkspacesList((prev) => [...prev.filter((w) => w.name !== trimmed), ws]);
    } catch {
      // Ignored
    }
    dispatch({ type: "SET_WORKSPACE", workspace: ws });
    setActiveWsName(trimmed);
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
  }, [activeWsName, files, roles, labelMode, yJoin, targetCol, mergeKey, mergeInTest, workspace?.steps]);

  // Compute live preview shapes and engine errors
  useEffect(() => {
    let active = true;
    const ws = buildResult.workspace;

    if (buildResult.errors.length > 0) {
      setEngineErrors(buildResult.errors);
      return;
    }

    setEngineErrors([]);

    apiClient
      .previewWorkspace(ws, "train", 5)
      .then((res) => {
        if (!active) return;
        setTrainPreviewShape(res.shape);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const msg = (err as EngineError).message || String(err);
        setEngineErrors((prev) => [...prev, msg]);
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
          const msg = (err as EngineError).message || String(err);
          setEngineErrors((prev) => [...prev, msg]);
        });
    } else {
      setTestPreviewShape(null);
    }

    return () => {
      active = false;
    };
  }, [buildResult]);

  // Role click handler
  const handlePickRole = (fileId: string, role: FileRole) => {
    setRoles((prev) => ({ ...prev, [fileId]: role }));
    setGuessedMap((prev) => ({ ...prev, [fileId]: false }));
  };

  // Upload new file
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

      let spec: FileSourceSpec = { kind: "csv", path: uploadRes.path };
      if (inspectRes.metrics.load_spec) {
        try {
          spec = JSON.parse(String(inspectRes.metrics.load_spec)) as CsvSource;
        } catch {
          // Keep default spec
        }
      }

      let cols: string[] = [];
      try {
        const colList = await apiClient.sourceColumns(spec);
        cols = colList.map((c) => c.name);
      } catch {
        // Ignored
      }

      const id = `f_${Date.now()}`;
      const detected = formatDetected(inspectRes.metrics, [
        Number(inspectRes.metrics.rows ?? 0),
        cols.length,
      ]);
      const guessedRole = guessFileRole(file.name, roles);

      const newItem: SourceFileItem = {
        id,
        name: file.name,
        path: uploadRes.path,
        cols,
        detected,
        spec,
        rowCount: Number(inspectRes.metrics.rows ?? 0),
        isGuessed: true,
      };

      setFiles((prev) => [...prev, newItem]);
      setRoles((prev) => ({ ...prev, [id]: guessedRole }));
      setGuessedMap((prev) => ({ ...prev, [id]: true }));
    } catch (err: unknown) {
      const msg = (err as EngineError).message || String(err);
      setEngineErrors((prev) => [...prev, msg]);
    }
  };

  // Find train X and merge files
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

  const handleSaveAndNavigate = async (screen: "align" | "bench") => {
    const ws = buildResult.workspace;
    try {
      await apiClient.saveWorkspace(ws);
    } catch {
      // Ignore save error on client side preview
    }
    dispatch({ type: "SET_WORKSPACE", workspace: ws });
    dispatch({ type: "SET_SCREEN", screen });
  };

  // Shape formatting
  const trainShapeText = trainPreviewShape
    ? `${trainPreviewShape[0]} × ${trainPreviewShape[1]}`
    : trainXFile
      ? `${trainXFile.rowCount ?? 20} × ${trainXFile.cols.length + (trainYFile ? 1 : 0) + (mergeFile ? commonMergeCols.length : 0)}`
      : "—";

  const testFile = files.find((f) => roles[f.id] === "testX");
  const testShapeText = testPreviewShape
    ? `${testPreviewShape[0]} × ${testPreviewShape[1]}`
    : testFile
      ? `${testFile.rowCount ?? 6} × ${testFile.cols.length + (mergeInTest && mergeFile ? commonMergeCols.length : 0)}`
      : "—";

  const displayedCols =
    trainXFile
      ? [
          ...trainXFile.cols,
          ...(trainYFile && labelMode === "yfile" ? trainYFile.cols : []),
          ...(mergeFile
            ? mergeFile.cols.filter((c) => c !== mergeKey)
            : []),
        ]
      : [];

  return (
    <div className="sources-layout" aria-label="Sources screen">
      {/* Sidebar: Workspaces list */}
      <aside className="sources-sidebar" aria-label="Workspaces">
        <div className="sources-sidebar-title">Workspaces</div>
        <div className="sources-sidebar-desc">
          A workspace = which files make train and test, how the label joins, and
          the ordered log of steps.
        </div>

        {workspacesList.map((ws) => {
          const isActive = ws.name === activeWsName;
          return (
            <button
              key={ws.name}
              type="button"
              className={`ws-item ${isActive ? "active" : ""}`}
              onClick={() => handleSelectWorkspace(ws.name)}
              aria-current={isActive ? "true" : undefined}
            >
              <span className="ws-item-name">{ws.name}</span>
              <span className="ws-item-meta">
                {ws.steps.length} steps · {isActive ? "open" : "saved"}
              </span>
            </button>
          );
        })}

        {/* Fallback default workspaces if empty */}
        {workspacesList.length === 0 && (
          <>
            <button
              type="button"
              className={`ws-item ${activeWsName === "churn" ? "active" : ""}`}
              onClick={() => handleSelectWorkspace("churn")}
            >
              <span className="ws-item-name">churn</span>
              <span className="ws-item-meta">4 files · 0 steps · open</span>
            </button>
            <button
              type="button"
              className={`ws-item ${activeWsName === "parkinson" ? "active" : ""}`}
              onClick={() => handleSelectWorkspace("parkinson")}
            >
              <span className="ws-item-name">parkinson</span>
              <span className="ws-item-meta">3 files · 0 steps</span>
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
                onClick={handleCreateWorkspace}
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

      {/* Main Content Area */}
      <main className="sources-main">
        <div className="sources-header">
          <span className="sources-title">Sources of “{activeWsName}”</span>
          <span className="sources-subtitle">
            Roles were guessed from the file names. Check them: nothing is loaded
            until you continue.
          </span>
        </div>

        {/* Files Section */}
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

                <div className="file-roles" role="group" aria-label={`Role for ${fl.name}`}>
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
                          <span className="chip-guess-dot" title="Guessed from file name">
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
              onChange={handleFileUpload}
            />
            <label htmlFor={fileInputId} className="btn-add-file" style={{ display: "inline-flex", alignItems: "center" }}>
              + Add a file (csv, parquet, excel, json, sql query)
            </label>
          </div>
        </section>

        {/* Target and Merge Cards */}
        <div className="two-col-grid">
          {/* Target Card */}
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
              className={`label-info ${buildResult.targetLabel ? "success" : "error"}`}
            >
              {buildResult.info.y ||
                (labelMode === "yfile" && !trainYFile
                  ? "No file has the role “Train y”."
                  : "")}
            </div>
          </section>

          {/* Merge Card */}
          <section className="sources-card-padded" aria-label="Merge settings">
            <div className="sources-card-title">Merge</div>
            {mergeFile ? (
              <>
                <div style={{ fontSize: "12px", color: "var(--dtk-muted)" }}>
                  Left join{" "}
                  <strong style={{ fontFamily: "var(--dtk-font-mono)", color: "var(--dtk-ink)" }}>
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
              <div style={{ fontSize: "12px", color: "var(--dtk-muted)", lineHeight: 1.5 }}>
                Give a file the role “Merge” to join extra columns (one row per key)
                onto train and test.
              </div>
            )}
          </section>
        </div>

        {/* Result Card */}
        <section className="sources-card-padded" aria-label="Result schema">
          <div className="res-header">
            <span className="sources-card-title">Result</span>
            <span className="res-shape">
              train {trainShapeText} · test {testShapeText}
            </span>
          </div>

          <div className="chips-row">
            {displayedCols.map((col) => {
              const origin = buildResult.originMap[col] || "x";
              const isTarget = col === buildResult.targetLabel;
              return (
                <span
                  key={col}
                  className={`res-col-chip origin-${origin}`}
                >
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
        </section>

        {/* Action Buttons */}
        <div className="sources-actions">
          <button
            type="button"
            className="btn-primary-action"
            onClick={() => handleSaveAndNavigate("align")}
          >
            Check train / test alignment →
          </button>
          <button
            type="button"
            className="btn-secondary-action"
            onClick={() => handleSaveAndNavigate("bench")}
          >
            Open workbench
          </button>
        </div>
      </main>
    </div>
  );
}
