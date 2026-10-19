import type { ReactNode } from "react";

import { useAppDispatch } from "../../state/AppStore";
import { groupCountLabel, groupEndVersion, originLabel, type GroupRow } from "./groupRows";

/**
 * A step group of several steps in the pipeline bar (datatoolkit-issues#249):
 * one header card (name, intent, step count, shape after its last step) that
 * selects the END of the group, a disclosure button that shows its steps, and
 * a remove button for the whole group. `children` are the step nodes, shown
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
    <div className="pipeline-node-wrap pipeline-group" data-group-id={group.id}>
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
          <span className="pipeline-sub pipeline-group-intent">{group.intent || " "}</span>
          <span className="pipeline-meta">
            <span className="pipeline-shape">{shape}</span>
            <span className="pipeline-delta delta-muted">{groupCountLabel(row)}</span>
            {origin ? <span className="pipeline-badge pipeline-group-origin">{origin}</span> : null}
          </span>
        </button>
        <button
          type="button"
          className="pipeline-edit pipeline-group-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? "Collapse" : "Expand"} group ${group.name}`}
          title={expanded ? "Hide the steps of this group" : "Show the steps of this group"}
          onClick={onToggle}
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
