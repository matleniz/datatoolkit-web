import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import type { Result } from "../../api/types";
import { EngineError } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import type { CourseStage } from "../../state/reducer";
import { toEngineParams } from "../presets";
import { useWorkbenchData } from "../WorkbenchData";
import { datasetSource, targetColumnOf } from "./datasetSource";
import { keyParamsFromSchema } from "./keyParams";
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
  const { loading: gridLoading, columns } = useWorkbenchData();
  const [cards, setCards] = useState<SuggestionCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Per-card subset picks for duplicates "pass subset" cards (MAT-155). */
  const [subsetPicks, setSubsetPicks] = useState<Record<string, string[]>>({});

  const gridReady = !gridLoading && columns.length > 0;
  // Identity for "workspace changed" without object-identity churn from saves.
  const wsKey = workspace
    ? `${workspace.name}|${workspace.steps.length}|${workspace.variables.length}|${workspace.datasets.train.x.path}`
    : "";
  const rechecking = loading && cards.length > 0;

  useEffect(() => {
    if (!workspace?.datasets.train.x.path) {
      setCards([]);
      dispatch({ type: "SET_SUG_COUNT", count: 0 });
      return;
    }
    // Run once per workspace change, after the grid is ready (MAT-144).
    if (!gridReady) return;

    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        if (window.__DTK_WORKSPACE_SAVED__) {
          await window.__DTK_WORKSPACE_SAVED__;
        }
        if (cancelled) return;
        const source = datasetSource(workspace, "train", true);
        let target = targetColumnOf(workspace);
        if (!target && workspace.datasets.train.y) {
          target = workspace.name === "churn" ? "churn" : "target";
        }
        const available: Record<string, unknown> = { source };
        if (target) available.target = target;
        if (workspace.datasets.test?.x) {
          available.test = datasetSource(workspace, "test", false);
        }

        // Parallel across keys (schema→run stays sequential per key).
        const settled = await Promise.all(
          SUGGESTION_KEYS.map(async (keyId) => {
            if (keyId === "feature_selection" && !target) {
              return null;
            }
            try {
              const schema = await apiClient.keySchema(keyId);
              const params = keyParamsFromSchema(schema, available);
              const result = await apiClient.runKey(keyId, params);
              return { keyId, result, error: null as string | null };
            } catch (e) {
              const msg = e instanceof EngineError ? e.message : String(e);
              return {
                keyId,
                result: null as Result | null,
                error: `${keyId}: ${msg}`,
              };
            }
          }),
        );
        if (cancelled) return;

        const results: { keyId: string; result: Result }[] = [];
        const errors: string[] = [];
        for (const item of settled) {
          if (!item) continue;
          if (item.result) results.push({ keyId: item.keyId, result: item.result });
          if (item.error) errors.push(item.error);
        }
        const next = mapSuggestionCards(results);
        setCards(next);
        dispatch({ type: "SET_SUG_COUNT", count: next.length });
        if (errors.length) {
          setError(errors.join("\n"));
        } else {
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof EngineError ? e.message : String(e));
        setCards([]);
        dispatch({ type: "SET_SUG_COUNT", count: 0 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Run promptly after the save gate — no multi-second idle defer
    // (that made applied suggestions look stuck until a manual reload).
    void run();

    return () => {
      cancelled = true;
    };
  }, [wsKey, gridReady, workspace, dispatch]);

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
                <div className="chip-row" role="group" aria-label="Duplicate subset">
                  {columns.map((c) => {
                    const picked = subsetPicks[cd.id] ?? [];
                    const on = picked.includes(c.name);
                    return (
                      <button
                        key={c.name}
                        type="button"
                        className={on ? "small-chip on" : "small-chip"}
                        aria-pressed={on}
                        onClick={() => {
                          setSubsetPicks((prev) => {
                            const cur = prev[cd.id] ?? [];
                            const next = on
                              ? cur.filter((n) => n !== c.name)
                              : [...cur, c.name];
                            return { ...prev, [cd.id]: next };
                          });
                        }}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
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
