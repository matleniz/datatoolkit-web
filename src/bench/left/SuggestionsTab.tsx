import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import type { Result } from "../../api/types";
import { EngineError } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import type { CourseStage } from "../../state/reducer";
import { toEngineParams } from "../presets";
import { WIDE_COL_THRESHOLD } from "../grid/columnWindow";
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

  const gridReady = !gridLoading && columns.length > 0;
  // Identity for "workspace changed" without object-identity churn from saves.
  const wsKey = workspace
    ? `${workspace.name}|${workspace.steps.length}|${workspace.variables.length}|${workspace.datasets.train.x.path}`
    : "";

  useEffect(() => {
    if (!workspace?.datasets.train.x.path) {
      setCards([]);
      dispatch({ type: "SET_SUG_COUNT", count: 0 });
      return;
    }
    // Run once per workspace change, after the grid is ready (MAT-144).
    if (!gridReady) return;

    let cancelled = false;
    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        if (window.__DTK_WORKSPACE_SAVED__) {
          await window.__DTK_WORKSPACE_SAVED__;
        }
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

        const results: { keyId: string; result: Result }[] = [];
        const errors: string[] = [];
        for (const keyId of SUGGESTION_KEYS) {
          if (cancelled) return;
          if (keyId === "feature_selection" && !target) continue;
          try {
            const schema = await apiClient.keySchema(keyId);
            const params = keyParamsFromSchema(schema, available);
            const result = await apiClient.runKey(keyId, params);
            results.push({ keyId, result });
          } catch (e) {
            const msg = e instanceof EngineError ? e.message : String(e);
            errors.push(`${keyId}: ${msg}`);
          }
        }
        if (cancelled) return;
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

    // Wide frames: defer suggestion keys so first paint / Apply stay responsive
    // (MAT-152). Narrow frames keep the short idle delay from MAT-144.
    const deferMs = columns.length >= WIDE_COL_THRESHOLD ? 750 : 0;
    const schedule = () => {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        idleHandle = window.requestIdleCallback(() => {
          void run();
        }, { timeout: deferMs + 2000 });
      } else {
        timeoutHandle = setTimeout(() => void run(), deferMs || 16);
      }
    };
    if (deferMs > 0) {
      timeoutHandle = setTimeout(schedule, deferMs);
    } else {
      schedule();
    }

    return () => {
      cancelled = true;
      if (idleHandle !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    };
  }, [wsKey, gridReady, workspace, dispatch, columns.length]);

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
      {loading || (!gridReady && workspace?.datasets.train.x.path) ? (
        <div className="muted">Loading suggestions…</div>
      ) : null}
      {error ? (
        <div className="engine-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="sug-list" data-sug-cards={shown.length}>
        {shown.map((cd) => (
          <div key={cd.id} className="sug-card" data-sug-id={cd.id}>
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
