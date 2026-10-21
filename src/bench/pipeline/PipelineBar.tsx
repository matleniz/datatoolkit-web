import { useCallback, useState, type ReactNode } from "react";

import type { Role, Step } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { openStepPicker } from "../toolrail/tools";
import {
  FITTING_OPS,
  STAGE_COLOR,
  STAGES,
  opTitle,
  stepStage,
  stepSubLabel,
  stepSummary,
} from "../stages";
import { BusyIndicator } from "../../BusyIndicator";
import { useInFlight } from "../../useInFlight";
import { useWorkbenchData, type PipelineShape } from "../WorkbenchData";
import { PipelineHistory } from "./PipelineHistory";
import { GroupBlock } from "./GroupBlock";
import { GroupFormHost, GroupToolbar } from "./GroupTools";
import { useGroupEditing } from "./useGroupEditing";
import { groupRows, pruneExpanded, toggleExpanded } from "./groupRows";
import { rawNodeSubLabel } from "./rawNodeSubLabel";
import { NoteButton } from "../notes/NotePopover";
import { StepMenu, type StepMenuState } from "./StepMenu";

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

interface PipelineNodeData {
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
}

const signed = (n: number, unit: string) =>
  `${n > 0 ? "+" : "−"}${Math.abs(n)}${unit}`;

function stepDelta(
  step: Step,
  role: Role,
  prev: PipelineShape,
  shape: PipelineShape,
): { delta: string; deltaClass: string } {
  const dr = shape.rows - prev.rows;
  const dc = shape.cols - prev.cols;
  const parts: string[] = [];
  if (dr) parts.push(signed(dr, "r"));
  if (dc) parts.push(signed(dc, "c"));
  if (!parts.length) {
    parts.push(step.target !== "both" && step.target !== role ? "skipped" : "values");
  }
  let deltaClass = "delta-muted";
  if (dr < 0 || dc < 0) deltaClass = "delta-neg";
  else if (dc > 0) deltaClass = "delta-pos";
  return { delta: parts.join(" "), deltaClass };
}

function stepShapeLabel(
  err: string | undefined,
  shape: PipelineShape | undefined,
  known: boolean,
): string {
  if (err) return "—";
  if (shape) return `${shape.rows} × ${shape.cols}`;
  return known ? "…" : "—";
}

function stepTip(step: Step, err: string | undefined): string {
  if (err) return err;
  return `${step.op} ${JSON.stringify(step.params)} · applies to ${step.target}${step.align ? " · alignment" : ""}`;
}

function stepNode(
  step: Step,
  i: number,
  ctx: {
    err: string | undefined;
    shapes: PipelineShape[];
    role: Role;
    vi: number;
    canDelete: boolean;
  },
): PipelineNodeData {
  const { err, shapes, role, vi, canDelete } = ctx;
  const shape = shapes[i + 1];
  const prev = shapes[i];
  let d = { delta: "", deltaClass: "delta-muted" };
  if (err) d = { delta: "error", deltaClass: "delta-neg" };
  else if (prev && shape) d = stepDelta(step, role, prev, shape);
  const fitted = FITTING_OPS.has(step.op) && step.target !== "test";
  return {
    key: `v${i + 1}`,
    ver: `v${i + 1}`,
    title: opTitle(step.op),
    sub: err ? `fails: ${err}` : stepSubLabel(step.op, step.params),
    shape: stepShapeLabel(err, shape, shapes.length > 0),
    ...d,
    badge: `${step.target}${fitted ? " · fit" : ""}${step.align ? " · align" : ""}`,
    tip: stepTip(step, err),
    stage: stepStage(step.op, step.align),
    on: vi === i + 1,
    canDelete,
    error: !!err,
    stepIndex: i,
    version: i + 1,
  };
}

/** Note button of a step card (#152): the note follows the step id. */
function StepNoteButton({ step, index }: { step: Step; index: number }) {
  const dispatch = useAppDispatch();
  const { id } = step;
  if (!id) return null;
  return (
    <NoteButton
      className="pipeline-note"
      label={`step ${index + 1} (${opTitle(step.op)})`}
      text={step.note ?? null}
      onSave={(text) => dispatch({ type: "SET_STEP_NOTE", id, text })}
    />
  );
}

function nodeClass(n: PipelineNodeData): string {
  if (n.error) return "pipeline-node error";
  return n.on ? "pipeline-node on" : "pipeline-node";
}

/** W2 — pipeline bar (96px). */
export function PipelineBar() {
  const { workspace, role, viewVersion, editor, agentTouch } = useAppState();
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
  const canDelete = isLatest && !editor;
  // Any applied step can be reopened in the editor while none is open (#10).
  const canEdit = !editor;
  const frameBusy = useInFlight("frame") > 0;
  const [menu, setMenu] = useState<StepMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const rows = groupRows(steps, workspace?.groups ?? [], vi);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [expandedFor, setExpandedFor] = useState(workspace?.name);
  // Expanded state is UI-only: forgotten with a workspace switch, and per
  // group id when the group goes away.
  if (expandedFor !== workspace?.name) {
    setExpandedFor(workspace?.name);
    setExpanded(new Set());
  }
  const live = pruneExpanded(expanded, workspace?.groups ?? []);
  if (live !== expanded) setExpanded(live);

  const editing = useGroupEditing(workspace?.groups ?? [], dispatch, !!editor);
  const { picked, setPicked, setForm, refocus } = editing;
  const canGroup = canEdit;
  const canPick = canEdit && editing.selecting;
  const pickBox = (row: { group: { id: string; name: string } }, label: string) =>
    canPick ? (
      <input
        type="checkbox"
        className="pipeline-pick"
        aria-label={`Select ${label} for grouping`}
        checked={picked.has(row.group.id)}
        onChange={() => setPicked((p) => toggleExpanded(p, row.group.id))}
      />
    ) : null;

  const rawShape = shapes[0];
  const nodes: PipelineNodeData[] = [
    {
      key: "raw",
      ver: "raw",
      title: "sources",
      sub: workspace ? rawNodeSubLabel(workspace, role) : "—",
      shape: rawShape ? `${rawShape.rows} × ${rawShape.cols}` : "—",
      delta: "",
      deltaClass: "",
      badge: "",
      tip: "Sources, as set on the Sources screen",
      stage: "import",
      on: vi === 0,
      canDelete: false,
      stepIndex: null,
      version: 0,
    },
  ];
  for (let i = 0; i < steps.length; i++) {
    const err = stepErrors.get(i);
    nodes.push(stepNode(steps[i]!, i, { err, shapes, role, vi, canDelete }));
    if (err) break;
  }

  const renderNode = (n: PipelineNodeData, arrow: boolean, pick: ReactNode = null, firstStep?: string) => (
      <div key={n.key} className="pipeline-node-wrap" data-row-first-step={firstStep}>
        {arrow ? <Arrow /> : null}
        <div className="pipeline-node-rel">
          {pick}
          <button
            type="button"
            className={nodeClass(n)}
            style={{
              opacity: n.version > vi ? 0.5 : 1,
            }}
            title={n.tip}
            data-agent-touched={
              n.stepIndex !== null && agentTouch?.steps.includes(n.stepIndex) ? "1" : undefined
            }
            onClick={() =>
              dispatch({
                type: "SET_VIEW_VERSION",
                version: n.version === last ? null : n.version,
              })
            }
            onContextMenu={(e) => {
              if (!canEdit || n.stepIndex === null) return;
              e.preventDefault();
              setMenu({ index: n.stepIndex, x: e.clientX, y: e.clientY });
            }}
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
              <span className="pipeline-shape">{n.shape}</span>
              {n.delta ? (
                <span className={`pipeline-delta ${n.deltaClass}`}>
                  {n.delta}
                </span>
              ) : null}
              <span className="pipeline-badge">{n.badge}</span>
            </span>
          </button>
          {n.stepIndex === null ? (
            <NoteButton
              className="pipeline-note"
              label="the workspace"
              text={workspace?.notes?.workspace ?? null}
              onSave={(text) => dispatch({ type: "SET_WORKSPACE_NOTE", text })}
            />
          ) : (
            <StepNoteButton step={steps[n.stepIndex]!} index={n.stepIndex} />
          )}
          {canEdit && n.stepIndex !== null ? (
            <button
              type="button"
              className="pipeline-edit"
              aria-label="Edit this step"
              title="Edit step (Apply replaces it and the pipeline replays)"
              onClick={() =>
                dispatch({ type: "EDIT_STEP", index: n.stepIndex! })
              }
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M1.5 8.5l.6-2.4L6.6 1.6l1.8 1.8-4.5 4.5z"
                  fill="none"
                  stroke="#5b5850"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
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
  );

  return (
    <section
      className="pipeline-bar"
      aria-label="Pipeline"
      aria-busy={frameBusy}
      data-owner="W2"
    >
      <div className="pipeline-nodes">
        {renderNode(nodes[0]!, false)}
        {rows.map((row) => {
          if (row.start >= nodes.length - 1) return null;
          const rowNodes = nodes.slice(1 + row.start, 1 + row.start + row.count);
          if (row.singleton) {
            return renderNode(
              rowNodes[0]!,
              true,
              pickBox(row, `step ${row.start + 1}`),
              row.group.step_ids[0],
            );
          }
          return (
            <GroupBlock
              key={row.group.id}
              row={row}
              vi={vi}
              expanded={expanded.has(row.group.id) || rowNodes.some((n) => n.error)}
              error={rowNodes.some((n) => n.error)}
              canDelete={canDelete}
              shape={rowNodes.at(-1)?.shape ?? "—"}
              arrow={<Arrow />}
              onToggle={() => setExpanded((e) => toggleExpanded(e, row.group.id))}
              pick={pickBox(row, `group ${row.group.name}`)}
              onRename={
                canGroup
                  ? () =>
                      setForm({ kind: "rename", id: row.group.id, name: row.group.name, intent: row.group.intent })
                  : null
              }
              onUngroup={
                canGroup
                  ? () => {
                      refocus.current = row.group.step_ids[0] ?? null;
                      dispatch({ type: "UNGROUP", id: row.group.id });
                    }
                  : null
              }
            >
              {rowNodes.map((n) => renderNode(n, true))}
            </GroupBlock>
          );
        })}

        {pendingStep && preview ? (
          <>
            <Arrow dashed accent />
            <div className="pipeline-pending" aria-label="Pending step">
              <span className="pipeline-pending-kicker">Editing</span>
              <span className="pipeline-pending-title">
                {stepSummary(pendingStep.op, pendingStep.params)}
              </span>
              <span className="pipeline-pending-delta">{pendingDiffText}</span>
            </div>
          </>
        ) : null}

        <Arrow dashed />
        <button
          type="button"
          className="pipeline-add"
          onClick={() => openStepPicker(dispatch)}
        >
          + Step
        </button>
        <GroupToolbar editing={editing} />
      </div>

      <GroupFormHost editing={editing} />

      {menu && canEdit ? (
        <StepMenu
          menu={menu}
          title={`v${menu.index + 1} · ${opTitle(steps[menu.index]?.op ?? "")}`}
          canDelete={canDelete}
          onClose={closeMenu}
        />
      ) : null}

      <PipelineHistory />

      <BusyIndicator scope="frame" label="Running the pipeline…" />

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
