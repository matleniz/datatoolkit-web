import type { ReactNode } from "react";

import { useAppDispatch } from "../../state/AppStore";
import { groupCountLabel, groupEndVersion, originLabel, type GroupRow } from "./groupRows";

/**
 * A step group of several steps in the pipeline bar (datatoolkit-issues#249):
 * one header card (name, intent, step count, shape after its last step) that
 * selects the END of the group, a disclosure button that shows its steps, and
 * remove / rename / ungroup buttons for the whole group. A group that holds a
 * failing step stays open (its toggle says so and does nothing). `children` are the step nodes, shown
 * only while expanded. A group of one step never comes here: it renders as a
 * plain step row.
 */
export function GroupBlock({
  row,
  vi,
  expanded,
  error,
  canDelete,
  shape,
  onToggle,
  pick,
  onRename,
  onUngroup,
  arrow,
  children,
}: {
  row: GroupRow;
  vi: number;
  expanded: boolean;
  error: boolean;
  canDelete: boolean;
  shape: string;
  onToggle: () => void;
  /** The "select for grouping" checkbox of this row (null while an edit is open). */
  pick: ReactNode;
  /** Rename and ungroup, offered while no step edit is open; null hides them. */
  onRename: (() => void) | null;
  onUngroup: (() => void) | null;
  /** The connector drawn before the header, as for every node. */
  arrow: ReactNode;
  children: ReactNode;
}) {
  const dispatch = useAppDispatch();
  const { group } = row;
  const end = groupEndVersion(row);
  const origin = originLabel(group);
  const panelId = `pipeline-group-${group.id}`;
  const cls = ["pipeline-node", "pipeline-group-head"];
  if (error) cls.push("error");
  else if (vi === end) cls.push("on");
  if (row.partial) cls.push("partial");
  const tip = [group.name, group.intent].filter(Boolean).join("\n");
  const remove = () => {
    const msg = `Remove the group “${group.name}” and its ${row.count} steps? The pipeline replays; you can undo it.`;
    if (window.confirm(msg)) dispatch({ type: "REMOVE_GROUP", id: group.id });
  };

  return (
    <div
      className="pipeline-node-wrap pipeline-group"
      data-group-id={group.id}
      data-row-first-step={group.step_ids[0]}
    >
      {arrow}
      <div className="pipeline-node-rel">
        <button
          type="button"
          className={cls.join(" ")}
          style={{ opacity: row.start >= vi ? 0.5 : 1 }}
          title={tip}
          onClick={() => dispatch({ type: "SET_VIEW_VERSION", version: end })}
        >
          <span className="pipeline-stage-bar pipeline-group-bar" />
          <span className="pipeline-node-top">
            <span className="pipeline-ver">v{end}</span>
            <span className="pipeline-title" title={group.name}>
              {group.name}
            </span>
          </span>
          <span className="pipeline-sub pipeline-group-intent">{group.intent || "\u00a0"}</span>
          <span className="pipeline-meta">
            {/* The shape is the one after the whole group: not shown while the view cuts it. */}
            {row.partial ? null : <span className="pipeline-shape">{shape}</span>}
            <span className="pipeline-delta delta-muted pipeline-group-count">{groupCountLabel(row)}</span>
            {origin ? (
              <span className="pipeline-group-origin" title={`Made by: ${origin}`}>
                {origin}
              </span>
            ) : null}
          </span>
        </button>
        {pick}
        <button
          type="button"
          className="pipeline-edit pipeline-group-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-disabled={error || undefined}
          aria-label={
            error
              ? `Group ${group.name} stays open: one of its steps fails`
              : `${expanded ? "Collapse" : "Expand"} group ${group.name}`
          }
          title={
            error
              ? "This group stays open because one of its steps fails"
              : expanded
                ? "Hide the steps of this group"
                : "Show the steps of this group"
          }
          onClick={error ? undefined : onToggle}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d={expanded ? "M2 6.5l3-3 3 3" : "M2 3.5l3 3 3-3"}
              fill="none"
              stroke="#5b5850"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {onRename ? (
          <button
            type="button"
            className="pipeline-note pipeline-group-rename"
            aria-label={`Rename group ${group.name}`}
            title="Rename this group or change its intent"
            onClick={onRename}
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
        {onUngroup ? (
          <button
            type="button"
            className="pipeline-note pipeline-group-ungroup"
            aria-label={`Ungroup ${group.name}`}
            title="Ungroup: each step becomes its own row again"
            onClick={onUngroup}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1.5 3.5h7M1.5 6.5h7" stroke="#5b5850" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            className="pipeline-remove"
            aria-label={`Remove group ${group.name} and replay`}
            title="Remove the whole group (the pipeline replays)"
            onClick={remove}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 2l6 6M8 2l-6 6" stroke="#5b5850" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div id={panelId} className="pipeline-group-steps" role="group" aria-label={`Steps of ${group.name}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
