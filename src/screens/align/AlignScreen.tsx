import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "../../api/client";
import type {
  AlignReportRow,
  EngineError,
  Step,
  Workspace,
} from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import {
  computeRowFixes,
  countAlignStatuses,
  formatAlignmentStep,
  formatStepSummary,
  formatMean,
  formatSample,
  getStatusBadgeInfo,
  type AlignFixAction,
} from "./alignLogic";
import "./align.css";

export function AlignScreen() {
  const { workspace } = useAppState();
  const dispatch = useAppDispatch();

  const [alignRows, setAlignRows] = useState<AlignReportRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [castErrors, setCastErrors] = useState<Record<string, string>>({});
  const [alignReportError, setAlignReportError] = useState<string | null>(null);

  // Filter workspace to only its alignment steps for POST /workspace/align
  const alignWorkspace: Workspace = useMemo(() => {
    if (!workspace) {
      return {
        name: "churn",
        datasets: {
          train: {
            x: {
              kind: "csv",
              path: "/home/matleniz/wt-datatoolkit-web/w1-sources-align/e2e/fixtures/churn_train.csv",
            },
            y: {
              kind: "csv",
              path: "/home/matleniz/wt-datatoolkit-web/w1-sources-align/e2e/fixtures/churn_labels.csv",
            },
          },
          test: {
            x: {
              kind: "csv",
              path: "/home/matleniz/wt-datatoolkit-web/w1-sources-align/e2e/fixtures/churn_test.csv",
            },
          },
        },
        label: { mode: "order" },
        merges: [],
        variables: [],
        steps: [],
      };
    }

    return {
      ...workspace,
      steps: workspace.steps.filter((s) => s.align),
    };
  }, [workspace]);

  // Load alignment report
  const fetchAlignReport = useCallback(async () => {
    setLoading(true);
    setAlignReportError(null);
    try {
      const rep = await apiClient.alignReport(alignWorkspace);
      const rows = rep.columns || [];
      setAlignRows(rows);

      const counts = countAlignStatuses(rows);
      dispatch({ type: "SET_ALIGN_TO_DECIDE_COUNT", count: counts.fix });

      // Probe cast errors for columns with numbers_as_text
      const errors: Record<string, string> = {};
      for (const r of rows) {
        if (r.status === "type_mismatch" && r.numbers_as_text) {
          const colName = r.train?.name ?? r.test?.name;
          if (colName) {
            try {
              const testStep: Step = {
                op: "cast",
                target: "test",
                params: { dtypes: { [colName]: "float" } },
              };
              await apiClient.previewStep(alignWorkspace, testStep, "test");
            } catch (err: unknown) {
              const msg = (err as EngineError).message || String(err);
              errors[colName] = msg;
            }
          }
        }
      }
      setCastErrors(errors);
    } catch (err: unknown) {
      const msg = (err as EngineError).message || String(err);
      setAlignReportError(msg);
    } finally {
      setLoading(false);
    }
  }, [alignWorkspace, dispatch]);

  useEffect(() => {
    fetchAlignReport();
  }, [fetchAlignReport]);

  // Status counts
  const counts = useMemo(() => {
    return countAlignStatuses(alignRows);
  }, [alignRows]);

  // Find all test-only column names
  const testOnlyCols = useMemo(() => {
    return alignRows
      .filter((r) => r.status === "extra_in_test" && r.test)
      .map((r) => r.test!.name);
  }, [alignRows]);

  // Action execution
  const handleExecuteFix = (action: AlignFixAction) => {
    if (action.type === "set_decimal") {
      dispatch({
        type: "SET_TEST_DECIMAL",
        decimal: action.decimal ?? null,
      });
    } else if (action.type === "add_step" && action.step) {
      dispatch({
        type: "ADD_ALIGN_STEP",
        step: action.step,
      });
    }
  };

  const handleRemoveSourceOption = () => {
    dispatch({ type: "SET_TEST_DECIMAL", decimal: null });
  };

  const handleRemoveAlignmentStep = (stepIndex: number) => {
    dispatch({ type: "REMOVE_STEP_BY_INDEX", index: stepIndex });
  };

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleOpenWorkbench = async () => {
    if (workspace) {
      try {
        await apiClient.saveWorkspace(workspace);
        setSaveError(null);
      } catch (err: unknown) {
        const msg = (err as EngineError).message || String(err);
        setSaveError(msg);
        return;
      }
    }
    dispatch({ type: "SET_SCREEN", screen: "bench" });
  };
  // Inspect source option on test
  const testSource = alignWorkspace.datasets.test?.x;
  const testDecimalOption =
    testSource && testSource.kind === "csv" && testSource.decimal === ","
      ? ","
      : null;
  const testFileName =
    testSource && testSource.kind === "csv"
      ? testSource.path.split("/").pop() || "test.csv"
      : "test.csv";

  // Alignment steps list
  const alignmentStepsWithIndices = useMemo(() => {
    if (!workspace) return [];
    return workspace.steps
      .map((st, i) => ({ st, i }))
      .filter((item) => item.st.align);
  }, [workspace]);

  return (
    <div className="align-layout" aria-label="Train / test alignment">
      {/* Main Table Area */}
      <main className="align-main">
        <div className="align-header">
          <span className="align-title">Train / test alignment</span>
          <span className="align-subtitle">
            Test must carry train's columns with the same types before any fitted
            step. You decide each fix.
          </span>
        </div>

        {/* Counts summary chips */}
        <div className="align-counts-row" role="group" aria-label="Alignment counts">
          <span className="align-count-chip matched">
            {counts.ok} matched
          </span>
          <span className="align-count-chip to-decide">
            {counts.fix} to decide
          </span>
          <span className="align-count-chip expected">
            {counts.info} expected
          </span>
        </div>

        {alignReportError && (
          <div
            className="engine-error-box"
            role="alert"
            style={{ marginBottom: "10px" }}
          >
            {alignReportError}
          </div>
        )}

        {saveError && (
          <div
            className="engine-error-box"
            role="alert"
            style={{ marginBottom: "10px" }}
          >
            {saveError}
          </div>
        )}

        {/* Alignment Table */}
        <section className="align-table-card">
          <div className="align-table-header">
            <span className="col-align-train">Train</span>
            <span className="col-align-status">Status</span>
            <span className="col-align-test">Test</span>
            <span className="col-align-mean">Train / test mean</span>
            <span className="col-align-fix">Your fix</span>
          </div>

          {loading && alignRows.length === 0 ? (
            <div style={{ padding: "20px 14px", color: "var(--dtk-muted)" }}>
              Loading alignment report...
            </div>
          ) : (
            alignRows.map((r, idx) => {
              const badge = getStatusBadgeInfo(r.status);
              const needsFix = r.status !== "match" && r.status !== "label";
              const colKey = r.train?.name ?? r.test?.name ?? `row_${idx}`;
              const castError = castErrors[colKey] || null;
              const { note, actions } = computeRowFixes(
                r,
                testOnlyCols,
                castError,
              );

              let meansText = "—";
              if (r.train_mean !== null || r.test_mean !== null) {
                meansText = `${formatMean(r.train_mean)} / ${formatMean(r.test_mean)}`;
              }

              return (
                <div
                  key={colKey}
                  className={`align-table-row ${needsFix ? "needs-fix" : ""}`}
                >
                  {/* Train side */}
                  <div className="col-align-train align-side-info">
                    {r.train ? (
                      <>
                        <span className="align-col-name">{r.train.name}</span>
                        <span className="align-col-sub" title={formatSample(r.train.samples)}>
                          {r.train.kind} · {formatSample(r.train.samples)}
                        </span>
                      </>
                    ) : (
                      <span className="align-col-name" style={{ color: "var(--dtk-muted)" }}>
                        —
                      </span>
                    )}
                  </div>

                  {/* Status badge */}
                  <div className="col-align-status">
                    <span
                      className="align-status-badge"
                      style={{ color: badge.color, background: badge.bg }}
                    >
                      {badge.text}
                    </span>
                  </div>

                  {/* Test side */}
                  <div className="col-align-test align-side-info">
                    {r.test ? (
                      <>
                        <span className="align-col-name">{r.test.name}</span>
                        <span className="align-col-sub" title={formatSample(r.test.samples)}>
                          {r.test.kind} · {formatSample(r.test.samples)}
                        </span>
                      </>
                    ) : (
                      <span className="align-col-name" style={{ color: "var(--dtk-muted)" }}>
                        —
                      </span>
                    )}
                  </div>

                  {/* Means */}
                  <div className="col-align-mean align-means-text">
                    {meansText}
                  </div>

                  {/* Your fix cell */}
                  <div className="col-align-fix align-fix-cell">
                    {note ? (
                      <span className="align-fix-note">{note}</span>
                    ) : null}

                    {actions.length > 0 ? (
                      <div className="align-fix-actions">
                        {actions.map((act) => (
                          <button
                            key={act.id}
                            type="button"
                            className={`btn-align-action ${act.primary ? "primary" : ""}`}
                            disabled={act.disabled}
                            title={act.tip}
                            onClick={() => handleExecuteFix(act)}
                          >
                            {act.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </main>

      {/* Right Aside: Your alignment */}
      <aside className="align-sidebar" aria-label="Your alignment">
        <div className="align-sidebar-title">Your alignment</div>
        <div className="align-sidebar-desc">
          Source options re-read a file. Steps are test-only (or train-only) and
          sit first in the pipeline. Remove any of them to undo.
        </div>

        <div className="align-section-label">Source options</div>
        {testDecimalOption ? (
          <div className="align-item-box">
            <span className="align-item-text">
              {testFileName} · decimal &quot;,&quot;
            </span>
            <button
              type="button"
              className="btn-remove-item"
              onClick={handleRemoveSourceOption}
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="empty-align-text">None.</div>
        )}

        <div className="align-section-label">Alignment steps</div>
        {alignmentStepsWithIndices.length > 0 ? (
          alignmentStepsWithIndices.map(({ st, i }) => (
            <div key={i} className="align-item-box">
              <div
                className="align-item-text align-item-step"
                title={formatAlignmentStep(st)}
              >
                <span className="align-item-op">{st.op}</span>
                <span className="align-item-sep" aria-hidden="true">
                  {" · "}
                </span>
                <span className="align-item-break" aria-hidden="true" />
                <span className="align-item-details">
                  {formatStepSummary(st)} · {st.target}
                </span>
              </div>
              <button
                type="button"
                className="btn-remove-item"
                onClick={() => handleRemoveAlignmentStep(i)}
              >
                Remove
              </button>
            </div>
          ))
        ) : (
          <div className="empty-align-text">None yet.</div>
        )}

        <div
          className={`align-ready-status ${counts.fix > 0 ? "differ" : "ready"}`}
        >
          {counts.fix > 0
            ? `${counts.fix} column${counts.fix > 1 ? "s" : ""} still differ. You can continue, but test will not match train on them.`
            : "Train and test have the same columns and types."}
        </div>

        <button
          type="button"
          className="btn-open-workbench"
          onClick={handleOpenWorkbench}
        >
          Open workbench →
        </button>

        <button
          type="button"
          className="btn-back-sources"
          onClick={() => dispatch({ type: "SET_SCREEN", screen: "sources" })}
        >
          ← Back to sources
        </button>
      </aside>
    </div>
  );
}
