import type { Dispatch } from "react";

import type { AppAction } from "../../state/AppStore";
import { toEngineParams } from "../presets";
import { Chips } from "../Chips";
import {
  STAGE_COLOR,
  STAGE_LABEL,
  type ListedSuggestion,
  type SuggestionCard,
} from "./suggestions";

/** Duplicates "pass subset" cards: pick identity columns, then open the editor (MAT-155). */
function SubsetPicker({
  card,
  columns,
  picks,
  onPicks,
  dispatch,
}: {
  card: SuggestionCard;
  columns: string[];
  picks: string[];
  onPicks: (next: string[]) => void;
  dispatch: Dispatch<AppAction>;
}) {
  return (
    <div className="sug-subset" data-sug-subset={card.id}>
      <div className="sug-subset-label muted">
        Pick identity columns (subset), then open Drop duplicates
      </div>
      <Chips
        small
        label="Duplicate subset"
        options={columns}
        isOn={(n) => picks.includes(n)}
        onPick={(n) =>
          onPicks(picks.includes(n) ? picks.filter((x) => x !== n) : [...picks, n])
        }
      />
      <button
        type="button"
        className="open-editor-btn"
        disabled={picks.length === 0}
        onClick={() =>
          dispatch({
            type: "OPEN_EDITOR",
            op: "drop_duplicates",
            params: toEngineParams("drop_duplicates", {
              subset: picks,
              keep: "none",
              sort_by: null,
            }),
            target: "train",
          })
        }
      >
        Open Drop duplicates →
      </button>
    </div>
  );
}

function OpenInEditor({
  card,
  dispatch,
}: {
  card: SuggestionCard;
  dispatch: Dispatch<AppAction>;
}) {
  const step = card.step;
  if (!step) return null;
  return (
    <button
      type="button"
      className="open-editor-btn"
      onClick={() => {
        if (card.column) dispatch({ type: "PICK_COL", name: card.column });
        dispatch({
          type: "OPEN_EDITOR",
          op: step.op,
          params: toEngineParams(step.op, step.params),
          target: step.target,
        });
      }}
    >
      Open in editor →
    </button>
  );
}

/** One Suggestions card, with its dismiss / restore action (datatoolkit-issues#15). */
export function SuggestionCardView({
  item,
  stale,
  columns,
  picks,
  onPicks,
  onToggleDismiss,
  dispatch,
}: {
  item: ListedSuggestion;
  stale: boolean;
  columns: string[];
  picks: string[];
  onPicks: (next: string[]) => void;
  onToggleDismiss: () => void;
  dispatch: Dispatch<AppAction>;
}) {
  const { card, dismissId, dismissed } = item;
  return (
    <div
      className={dismissed ? "sug-card dismissed" : "sug-card"}
      data-sug-id={card.id}
      data-sug-dismiss-id={dismissId}
      data-sug-dismissed={dismissed ? "1" : undefined}
      data-sug-stale={stale ? "1" : undefined}
    >
      <div className="sug-stage">
        <span className="sug-dot" style={{ background: STAGE_COLOR[card.stage] }} />
        <span className="muted">{STAGE_LABEL[card.stage]}</span>
        <button
          type="button"
          className="link-btn sug-dismiss"
          title={
            dismissed
              ? "Show this suggestion again"
              : "Hide this suggestion (it stays hidden until the finding changes)"
          }
          onClick={onToggleDismiss}
        >
          {dismissed ? "Restore" : "Dismiss"}
        </button>
      </div>
      <div className="sug-title">{card.title}</div>
      <div className="sug-detail">{card.detail}</div>
      {dismissed ? null : card.pickSubset ? (
        <SubsetPicker
          card={card}
          columns={columns}
          picks={picks}
          onPicks={onPicks}
          dispatch={dispatch}
        />
      ) : (
        <OpenInEditor card={card} dispatch={dispatch} />
      )}
    </div>
  );
}
