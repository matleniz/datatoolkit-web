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
import { toEngineParams } from "../presets";
import { Chips } from "../Chips";
import { useWorkbenchData } from "../WorkbenchData";
import { targetColumnOf } from "./datasetSource";
import { keyParamsFromSchema } from "./keyParams";
import {
  STAGE_COLOR,
  STAGE_LABEL,
  SUGGESTION_KEYS,
  filterCardsByStage,
  mapSuggestionCards,
} from "./suggestions";

const STAGE_FILTERS: Partial<Record<CourseStage, string>> = {
  all: "All",
  import: "Import",
  clean: "Clean",
  transform: "Transform",
  select: "Select",
};

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
  const cards = run.value?.cards ?? [];
  const error = run.ready
    ? (run.error ?? (run.value?.errors.join("\n") || null))
    : null;
  const loading = !run.ready && gridReady;
  /** Identity the current cards were computed for. */
  const shownIdentity = run.settledKey;
  const rechecking = loading && cards.length > 0;

  useEffect(() => {
    dispatch({ type: "SET_SUG_COUNT", count: cards.length });
  }, [cards.length, dispatch]);

  const shown = filterCardsByStage(cards, sugStage);

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
      <div className="sug-list" data-sug-cards={shown.length}>
        {shown.map((cd) => (
          <div
            key={cd.id}
            className="sug-card"
            data-sug-id={cd.id}
            data-sug-stale={rechecking ? "1" : undefined}
          >
            <div className="sug-stage">
              <span
                className="sug-dot"
                style={{ background: STAGE_COLOR[cd.stage] }}
              />
              <span className="muted">{STAGE_LABEL[cd.stage]}</span>
            </div>
            <div className="sug-title">{cd.title}</div>
            <div className="sug-detail">{cd.detail}</div>
            {cd.pickSubset ? (
              <div className="sug-subset" data-sug-subset={cd.id}>
                <div className="sug-subset-label muted">
                  Pick identity columns (subset), then open Drop duplicates
                </div>
                <Chips
                  small
                  label="Duplicate subset"
                  options={columns.map((c) => c.name)}
                  isOn={(n) => (subsetPicks[cd.id] ?? []).includes(n)}
                  onPick={(n) =>
                    setSubsetPicks((prev) => {
                      const cur = prev[cd.id] ?? [];
                      const next = cur.includes(n)
                        ? cur.filter((x) => x !== n)
                        : [...cur, n];
                      return { ...prev, [cd.id]: next };
                    })
                  }
                />
                <button
                  type="button"
                  className="open-editor-btn"
                  disabled={(subsetPicks[cd.id] ?? []).length === 0}
                  onClick={() => {
                    const subset = subsetPicks[cd.id] ?? [];
                    dispatch({
                      type: "OPEN_EDITOR",
                      op: "drop_duplicates",
                      params: toEngineParams("drop_duplicates", {
                        subset,
                        keep: "none",
                        sort_by: null,
                      }),
                      target: "train",
                    });
                  }}
                >
                  Open Drop duplicates →
                </button>
              </div>
            ) : cd.step ? (
              <button
                type="button"
                className="open-editor-btn"
                onClick={() => {
                  if (cd.column) {
                    dispatch({ type: "PICK_COL", name: cd.column });
                  }
                  dispatch({
                    type: "OPEN_EDITOR",
                    op: cd.step!.op,
                    params: toEngineParams(cd.step!.op, cd.step!.params),
                    target: cd.step!.target,
                  });
                }}
              >
                Open in editor →
              </button>
            ) : null}
          </div>
        ))}
        {!loading && gridReady && !shown.length && !error ? (
          <div className="empty-dash">Nothing flagged here.</div>
        ) : null}
      </div>
    </div>
  );
}
