import { useAppDispatch, useAppState } from "../../state/AppStore";
import { FITTING_OPS, STAGE_COLOR, STAGES, stepStage, stepSubLabel } from "../stages";
import { useWorkbenchData } from "../WorkbenchData";

function Arrow({ dashed = false, accent = false }: { dashed?: boolean; accent?: boolean }) {
  return (
    <svg
      width="28"
      height="16"
      viewBox="0 0 28 16"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        d={dashed && !accent ? "M2 8h20" : "M2 8h20M17 3l6 5-6 5"}
        fill="none"
        stroke={accent ? "#1d5b86" : dashed ? "#c9c5ba" : "#a8a499"}
        strokeWidth="1.6"
        strokeDasharray={dashed || accent ? "3 3" : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** W2 — pipeline bar (96px). */
export function PipelineBar() {
  const { workspace, role, viewVersion, editor } = useAppState();
  const dispatch = useAppDispatch();
  const {
    shapes,
    stepErrors,
    pendingStep,
    pendingDiffText,
    isLatest,
    preview,
  } = useWorkbenchData();

  const steps = workspace?.steps ?? [];
  const last = steps.length;
  const vi =
    viewVersion === null || viewVersion > last ? last : viewVersion;
  const editing = !!editor;

  const nodes: {
    key: string;
    ver: string;
    title: string;
    sub: string;
    shape: string;
    delta: string;
    deltaClass: string;
    badge: string;
    tip: string;
    stage: string;
    on: boolean;
    canDelete: boolean;
    error?: boolean;
    stepIndex: number | null;
    version: number;
  }[] = [];

  // raw
  const rawShape = shapes[0];
  nodes.push({
    key: "raw",
    ver: "raw",
    title: "sources",
    sub:
      role === "train"
        ? "train X + y + extra"
        : `test X + extra${
            workspace?.datasets.test?.x?.kind === "csv" &&
            workspace.datasets.test.x.decimal === ","
              ? ' · dec ","'
              : ""
          }`,
    shape: rawShape
      ? `${rawShape.rows} × ${rawShape.cols}`
      : "—",
    delta: "",
    deltaClass: "",
    badge: "",
    tip: "Sources, as set on the Sources screen",
    stage: "import",
    on: vi === 0,
    canDelete: false,
    stepIndex: null,
    version: 0,
  });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const err = stepErrors.get(i);
    const shape = shapes[i + 1];
    const prev = shapes[i];
    let delta = "";
    let deltaClass = "delta-muted";
    if (prev && shape && !err) {
      const dr = shape.rows - prev.rows;
      const dc = shape.cols - prev.cols;
      const parts: string[] = [];
      if (dr) parts.push(`${dr > 0 ? "+" : "−"}${Math.abs(dr)}r`);
      if (dc) parts.push(`${dc > 0 ? "+" : "−"}${Math.abs(dc)}c`);
      if (!parts.length) {
        parts.push(
          step.target !== "both" && step.target !== role
            ? "skipped"
            : "values",
        );
      }
      delta = parts.join(" ");
      deltaClass =
        dr < 0 || dc < 0
          ? "delta-neg"
          : dc > 0
            ? "delta-pos"
            : "delta-muted";
    }
    if (err) {
      delta = "error";
      deltaClass = "delta-neg";
    }
    const fitted =
      FITTING_OPS.has(step.op) && step.target !== "test";
    nodes.push({
      key: `v${i + 1}`,
      ver: `v${i + 1}`,
      title: titleFor(step.op),
      sub: err ? `fails: ${err}` : stepSubLabel(step.op, step.params),
      shape: err ? "—" : shape ? `${shape.rows} × ${shape.cols}` : "—",
      delta,
      deltaClass,
      badge: `${step.target}${fitted ? " · fit" : ""}`,
      tip: err
        ? err
        : `${step.op} ${JSON.stringify(step.params)} · applies to ${step.target}${
            step.align ? " · alignment" : ""
          }`,
      stage: stepStage(step.op, step.align),
      on: vi === i + 1,
      canDelete: isLatest && !editing,
      error: !!err,
      stepIndex: i,
      version: i + 1,
    });
    if (err) break;
  }

  return (
    <section className="pipeline-bar" aria-label="Pipeline" data-owner="W2">
      <div className="pipeline-nodes">
        {nodes.map((n, i) => (
          <div key={n.key} className="pipeline-node-wrap">
            {i > 0 ? <Arrow /> : null}
            <div className="pipeline-node-rel">
              <button
                type="button"
                className={
                  n.error
                    ? "pipeline-node error"
                    : n.on
                      ? "pipeline-node on"
                      : "pipeline-node"
                }
                style={{
                  opacity: n.version > vi ? 0.5 : 1,
                }}
                title={n.tip}
                onClick={() =>
                  dispatch({
                    type: "SET_VIEW_VERSION",
                    version: n.version === last ? null : n.version,
                  })
                }
              >
                <span
                  className="pipeline-stage-bar"
                  style={{
                    background: n.error
                      ? "#a3242c"
                      : STAGE_COLOR[n.stage as keyof typeof STAGE_COLOR],
                  }}
                />
                <span className="pipeline-node-top">
                  <span className="pipeline-ver">{n.ver}</span>
                  <span className="pipeline-title">{n.title}</span>
                </span>
                <span className="pipeline-sub">{n.sub}</span>
                <span className="pipeline-meta">
                  <span>{n.shape}</span>
                  <span className={n.deltaClass}>{n.delta}</span>
                  <span className="pipeline-badge">{n.badge}</span>
                </span>
              </button>
              {n.canDelete && n.stepIndex !== null ? (
                <button
                  type="button"
                  className="pipeline-remove"
                  aria-label="Remove this step and replay"
                  title="Remove step (the pipeline replays)"
                  onClick={() =>
                    dispatch({ type: "REMOVE_STEP", index: n.stepIndex! })
                  }
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path
                      d="M2 2l6 6M8 2l-6 6"
                      stroke="#5b5850"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        ))}

        {pendingStep && preview ? (
          <>
            <Arrow dashed accent />
            <div className="pipeline-pending" aria-label="Pending step">
              <span className="pipeline-pending-kicker">Editing</span>
              <span className="pipeline-pending-title">
                {titleFor(pendingStep.op)} ·{" "}
                {stepSubLabel(pendingStep.op, pendingStep.params)}
              </span>
              <span className="pipeline-pending-delta">{pendingDiffText}</span>
            </div>
          </>
        ) : null}

        <Arrow dashed />
        <button
          type="button"
          className="pipeline-add"
          onClick={() =>
            dispatch({ type: "OPEN_EDITOR", op: null })
          }
        >
          + Step
        </button>
      </div>

      <div className="pipeline-legend">
        {STAGES.map((st) => (
          <span key={st.id} title={st.course}>
            <span
              className="pipeline-legend-dot"
              style={{ background: st.color }}
            />
            {st.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function titleFor(op: string): string {
  const map: Record<string, string> = {
    replace_sentinels: "Replace sentinels",
    impute: "Impute",
    onehot: "One-hot",
    standardize_text: "Standardize text",
    drop_columns: "Drop columns",
    drop_duplicates: "Drop duplicates",
    rename: "Rename",
    cast: "Cast type",
    clip: "Clip",
    scale: "Scale",
    ordinal: "Ordinal",
    formula: "Formula",
    log1p: "log1p",
    parse_dates: "Parse dates",
    datetime_parts: "Date parts",
    derive: "Derive",
  };
  return map[op] ?? op;
}
