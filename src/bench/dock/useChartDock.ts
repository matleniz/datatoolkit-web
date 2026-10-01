import { useEffect, useMemo } from "react";

import { apiClient } from "../../api/client";
import { useKeyedAsync } from "../../hooks";
import {
  ensureWorkspaceSaved,
  useAppDispatch,
  useAppState,
} from "../../state/AppStore";
import { identitySource } from "../dataIdentity";
import { targetColumnOf } from "../left/datasetSource";
import { keyParamsFromSchema } from "../left/keyParams";
import { useWorkbenchData } from "../WorkbenchData";
import {
  applyTile,
  CHART_TILES,
  pickerPool,
  recommendedTile,
  tileBlocker,
  tileOf,
  type ChartTileId,
  type PickerCol,
} from "./chartPicker";
import {
  chartDraftToParams,
  chartPrefillFromSelection,
  DEFAULT_CHART_DRAFT,
  type ChartDraft,
} from "./chartPrefill";

/** Draft state, derived picker data and the keyed `chart` run of the dock. */
export function useChartDock() {
  const { workspace, selection, chartDraft } = useAppState();
  const dispatch = useAppDispatch();
  const bench = useWorkbenchData();

  const identity = bench.identity;
  const colNames = useMemo(() => {
    if (bench.columns.length > 0) return bench.columns.map((c) => c.name);
    return [...bench.profiles.keys()];
  }, [bench.columns, bench.profiles]);

  const allCols: PickerCol[] = useMemo(
    () =>
      colNames.map((name) => {
        const meta = bench.columns.find((c) => c.name === name);
        const profile = bench.profiles.get(name);
        return {
          name,
          kind: meta?.kind ?? profile?.kind ?? "text",
          distinct: profile?.distinct,
        };
      }),
    [colNames, bench.columns, bench.profiles],
  );

  const draft: ChartDraft = chartDraft ?? DEFAULT_CHART_DRAFT;
  const target = workspace ? targetColumnOf(workspace) : null;
  const targetCol = target && colNames.includes(target) ? target : null;

  // Prefill once when the tool opens without a draft.
  useEffect(() => {
    if (chartDraft) return;
    const cols = selection.columns.map((name) => {
      const meta = bench.columns.find((c) => c.name === name);
      const kind = meta?.kind ?? bench.profiles.get(name)?.kind ?? "text";
      return { name, kind };
    });
    dispatch({
      type: "SET_CHART_DRAFT",
      draft: chartPrefillFromSelection(cols),
    });
  }, [
    chartDraft,
    selection.columns,
    bench.columns,
    bench.profiles,
    dispatch,
  ]);

  // identity.key covers role, version and the steps hash (MAT-175); the draft
  // counts by content, so unrelated workspace edits never re-run the chart.
  const run = useKeyedAsync(
    workspace?.datasets.train.x.path
      ? `${identity.key}\0${JSON.stringify(chartDraft)}`
      : null,
    async (alive) => {
      await ensureWorkspaceSaved(workspace);
      const schema = await apiClient.keySchema("chart");
      if (!alive() || !chartDraft) return undefined;
      const params = keyParamsFromSchema(schema, {
        source: identitySource(identity),
        ...chartDraftToParams(chartDraft),
      });
      const result = await apiClient.runKey("chart", params);
      return { result, runParams: JSON.stringify(params) };
    },
    !!chartDraft,
  );
  const { ready, error } = run;
  const shown = ready ? run.value : undefined;

  const patch = (p: Partial<ChartDraft>) =>
    dispatch({ type: "PATCH_CHART_DRAFT", patch: p });

  const activeTile = tileOf(draft.chart);
  const pool = useMemo(
    () => pickerPool(draft, selection.columns, allCols),
    [draft, selection.columns, allCols],
  );
  const selectedCols = useMemo(
    () =>
      selection.columns.flatMap((n) => allCols.filter((c) => c.name === n)),
    [selection.columns, allCols],
  );
  const blockers = useMemo(() => {
    const out: Partial<Record<ChartTileId, string>> = {};
    for (const t of CHART_TILES) {
      if (t.id === activeTile) continue;
      const why = tileBlocker(t.id, pool);
      if (why) out[t.id] = why;
    }
    return out;
  }, [pool, activeTile]);
  const recommended =
    selection.columns.length > 0 ? recommendedTile(selectedCols) : null;

  return {
    bench,
    identity,
    colNames,
    draft,
    targetCol,
    ready,
    error,
    result: shown?.result ?? null,
    runParams: shown?.runParams ?? null,
    shownIdentity: ready ? identity.key : null,
    saved: workspace?.charts ?? [],
    patch,
    activeTile,
    recommended,
    blockers,
    pickTile: (tile: ChartTileId) =>
      dispatch({ type: "SET_CHART_DRAFT", draft: applyTile(draft, tile, pool) }),
  };
}
