import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import { errorText } from "../../api/types";
import { useKeyedAsync } from "../../hooks";
import {
  ensureWorkspaceSaved,
  useAppDispatch,
  useAppState,
} from "../../state/AppStore";
import { identityLabel, identitySource, withRole } from "../dataIdentity";
import type { CourseStage } from "../../state/reducer";
import { Chips } from "../Chips";
import { useWorkbenchData } from "../WorkbenchData";
import { targetColumnOf } from "./datasetSource";
import { keyParamsFromSchema } from "./keyParams";
import { SuggestionCardView } from "./SuggestionCardView";
import {
  SUGGESTION_KEYS,
  listSuggestions,
  mapSuggestionCards,
  type SuggestionCard,
} from "./suggestions";
import { useDismissedSuggestions } from "./useDismissedSuggestions";

const STAGE_FILTERS: Partial<Record<CourseStage, string>> = {
  all: "All",
  import: "Import",
  clean: "Clean",
  transform: "Transform",
  select: "Select",
};

const NO_CARDS: SuggestionCard[] = [];

export function SuggestionsTab() {
  const { workspace, sugStage } = useAppState();
  const dispatch = useAppDispatch();
  const {
    loading: gridLoading,
    columns,
    identity: viewIdentity,
    pendingStep,
  } = useWorkbenchData();
  /** Per-card subset picks for duplicates "pass subset" cards (MAT-155). */
  const [subsetPicks, setSubsetPicks] = useState<Record<string, string[]>>({});
  const { dismissed: dismissedIds, toggle: toggleDismissed } =
    useDismissedSuggestions(workspace?.name);
  const [showDismissed, setShowDismissed] = useState(false);

  const gridReady = !gridLoading && columns.length > 0;
  /**
   * Suggestions are fitted-step advice, so they always analyse train (with
   * test for drift-aware keys) — at the version being viewed (MAT-175). The
   * identity key includes every step's params, not just the step count.
   */
  const identity = useMemo(
    () => withRole(workspace, viewIdentity, "train"),
    [workspace, viewIdentity],
  );
  const identityKey = identity.key;
  const hasTrain = !!workspace?.datasets.train.x.path;

  // Once per analysed identity, after the grid is ready (MAT-144). A grid
  // reload of the same identity does not re-run the keys (MAT-219).
  const run = useKeyedAsync(
    hasTrain ? identityKey : null,
    async () => {
      if (!workspace) return { cards: [], errors: [] };
      await ensureWorkspaceSaved(workspace);
      const source = identitySource(identity, true);
      let target = targetColumnOf(workspace);
      if (!target && workspace.datasets.train.y) {
        target = workspace.name === "churn" ? "churn" : "target";
      }
      const available: Record<string, unknown> = { source };
      if (target) available.target = target;
      if (workspace.datasets.test?.x) {
        available.test = identitySource(
          withRole(workspace, identity, "test"),
          false,
        );
      }
      // Parallel across keys (schema→run stays sequential per key).
      const settled = await Promise.all(
        SUGGESTION_KEYS.filter((k) => target || k !== "feature_selection").map(
          async (keyId) => {
            try {
              const schema = await apiClient.keySchema(keyId);
              const params = keyParamsFromSchema(schema, available);
              return { keyId, result: await apiClient.runKey(keyId, params) };
            } catch (e) {
              return { keyId, error: `${keyId}: ${errorText(e)}` };
            }
          },
        ),
      );
      return {
        cards: mapSuggestionCards(
          settled.flatMap((r) => (r.result ? [{ keyId: r.keyId, result: r.result }] : [])),
        ),
        errors: settled.flatMap((r) => (r.error ? [r.error] : [])),
      };
    },
    gridReady,
  );
  const cards = run.value?.cards ?? NO_CARDS;
  const error = run.ready
    ? (run.error ?? (run.value?.errors.join("\n") || null))
    : null;
  const loading = !run.ready && gridReady;
  /** Identity the current cards were computed for. */
  const shownIdentity = run.settledKey;
  const rechecking = loading && cards.length > 0;

  const { shown, dismissed: dismissedCount } = useMemo(
    () => listSuggestions(cards, sugStage, dismissedIds, showDismissed),
    [cards, sugStage, dismissedIds, showDismissed],
  );
  /** The badge counts every stage's non-dismissed cards. */
  const activeCount = useMemo(
    () => listSuggestions(cards, "all", dismissedIds, false).active,
    [cards, dismissedIds],
  );
  const columnNames = columns.map((c) => c.name);

  useEffect(() => {
    dispatch({ type: "SET_SUG_COUNT", count: activeCount });
  }, [activeCount, dispatch]);

  return (
    <div className="left-tab-body">
      <p className="left-help">
        What the analysis keys flag on train at the viewed version. A
        suggestion only opens the editor: nothing changes until you apply.
      </p>
      {workspace?.datasets.train.x.path ? (
        <div
          className={pendingStep ? "sug-identity editing" : "sug-identity"}
          data-identity={shownIdentity ?? ""}
          data-identity-current={identityKey}
          data-identity-version={identity.version}
          data-identity-editing={pendingStep ? "1" : "0"}
        >
          <span className="mono">{identityLabel(identity)}</span>
          {pendingStep ? (
            <span>
              {" "}
              · last applied version — the step being edited is not applied
              yet
            </span>
          ) : null}
        </div>
      ) : null}
      <Chips
        label="Suggestion stage"
        options={Object.keys(STAGE_FILTERS) as CourseStage[]}
        isOn={(id) => sugStage === id}
        onPick={(stage) => dispatch({ type: "SET_SUG_STAGE", stage })}
        text={(id) => STAGE_FILTERS[id]!}
      />
      {rechecking ? (
        <div className="muted" role="status" data-sug-rechecking="1">
          Re-checking…
        </div>
      ) : loading || (!gridReady && workspace?.datasets.train.x.path) ? (
        <div className="muted">Loading suggestions…</div>
      ) : null}
      {error ? (
        <div className="engine-error" role="alert">
          {error}
        </div>
      ) : null}
      {dismissedCount > 0 || showDismissed ? (
        <label className="sug-show-dismissed muted">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
          />{" "}
          Show dismissed ({dismissedCount})
        </label>
      ) : null}
      <div className="sug-list" data-sug-cards={shown.length}>
        {shown.map((item) => (
          <SuggestionCardView
            key={item.card.id}
            item={item}
            stale={rechecking}
            columns={columnNames}
            picks={subsetPicks[item.card.id] ?? []}
            onPicks={(next) =>
              setSubsetPicks((prev) => ({ ...prev, [item.card.id]: next }))
            }
            onToggleDismiss={() => toggleDismissed(item.dismissId)}
            dispatch={dispatch}
          />
        ))}
        {!loading && gridReady && !shown.length && !error ? (
          <div className="empty-dash">
            {dismissedCount > 0
              ? "Nothing flagged here (all dismissed)."
              : "Nothing flagged here."}
          </div>
        ) : null}
      </div>
    </div>
  );
}
