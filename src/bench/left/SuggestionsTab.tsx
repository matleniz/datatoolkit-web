import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import type { Result } from "../../api/types";
import { EngineError } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import type { CourseStage } from "../../state/reducer";
import { datasetSource, targetColumnOf } from "./datasetSource";
import {
  STAGE_COLOR,
  STAGE_LABEL,
  SUGGESTION_KEYS,
  filterCardsByStage,
  mapSuggestionCards,
  type SuggestionCard,
} from "./suggestions";

const STAGE_FILTERS: { id: CourseStage; label: string }[] = [
  { id: "all", label: "All" },
  { id: "import", label: "Import" },
  { id: "clean", label: "Clean" },
  { id: "transform", label: "Transform" },
  { id: "select", label: "Select" },
];

export function SuggestionsTab() {
  const { workspace, sugStage } = useAppState();
  const dispatch = useAppDispatch();
  const [cards, setCards] = useState<SuggestionCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace?.datasets.train.x.path) {
      setCards([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await apiClient.saveWorkspace(workspace);
        const source = datasetSource(workspace, "train", true);
        const target = targetColumnOf(workspace);
        const results: { keyId: string; result: Result }[] = [];
        for (const keyId of SUGGESTION_KEYS) {
          const params: Record<string, unknown> = { source };
          if (keyId === "preprocessing_advisor" && target) {
            params.target = target;
          }
          if (keyId === "missing_values" || keyId === "outliers") {
            if (workspace.datasets.test?.x) {
              params.test = datasetSource(workspace, "test", false);
            }
          }
          try {
            const result = await apiClient.runKey(keyId, params);
            results.push({ keyId, result });
          } catch (e) {
            // Keep going; surface one error if everything fails.
            if (results.length === 0 && e instanceof EngineError) {
              throw e;
            }
          }
        }
        if (cancelled) return;
        setCards(mapSuggestionCards(results));
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof EngineError ? e.message : String(e));
        setCards([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  const shown = useMemo(
    () => filterCardsByStage(cards, sugStage),
    [cards, sugStage],
  );

  return (
    <div className="left-tab-body">
      <p className="left-help">
        What the analysis keys flag on the latest train. A suggestion only
        opens the editor: nothing changes until you apply.
      </p>
      <div className="chip-row" role="group" aria-label="Suggestion stage">
        {STAGE_FILTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={sugStage === s.id ? "chip on" : "chip"}
            onClick={() =>
              dispatch({ type: "SET_SUG_STAGE", stage: s.id })
            }
          >
            {s.label}
          </button>
        ))}
      </div>
      {loading ? <div className="muted">Loading suggestions…</div> : null}
      {error ? <div className="engine-error" role="alert">{error}</div> : null}
      <div className="sug-list">
        {shown.map((cd) => (
          <div key={cd.id} className="sug-card">
            <div className="sug-stage">
              <span
                className="sug-dot"
                style={{ background: STAGE_COLOR[cd.stage] }}
              />
              <span className="muted">{STAGE_LABEL[cd.stage]}</span>
            </div>
            <div className="sug-title">{cd.title}</div>
            <div className="sug-detail">{cd.detail}</div>
            {cd.step ? (
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
                    params: cd.step!.params,
                    target: cd.step!.target,
                  });
                }}
              >
                Open in editor →
              </button>
            ) : null}
          </div>
        ))}
        {!loading && !shown.length ? (
          <div className="empty-dash">Nothing flagged here.</div>
        ) : null}
      </div>
    </div>
  );
}
