import { useState } from "react";

import { chartVisibility, moreOptionCount } from "./chartDockModel";
import {
  ChartEncodeRow,
  ChartMoreForm,
  ChartRunStatus,
  ChartSavedBar,
} from "./ChartDockParts";
import { ChartTypePicker } from "./ChartTypePicker";
import { IdentityStrip } from "./IdentityStrip";
import { useChartDock } from "./useChartDock";
import "./ChartDock.css";

/**
 * Chart builder dock body (MAT-172, reworked MAT-240): chart type as icon
 * tiles, x / y / colour in one compact row, the rest under "More", and the
 * figure filling the window (MAT-235 shell) → run_key("chart").
 * Prefill from selection / chartDraft; saved specs live on workspace.charts.
 */
export function ChartDockBody() {
  const dock = useChartDock();
  const [moreOpen, setMoreOpen] = useState(false);
  const { draft, identity, shownIdentity, colNames, targetCol, patch } = dock;
  const vis = chartVisibility(draft);

  return (
    <div
      className="chart-dock"
      data-engine-key="chart"
      data-chart-type={draft.chart}
      data-chart-x={draft.x ?? ""}
      data-chart-y={draft.y ?? ""}
      data-chart-color={draft.color ?? ""}
      data-chart-trendline={draft.trendline ? "1" : "0"}
      data-identity={shownIdentity ?? ""}
      data-identity-current={identity.key}
      data-run-params={dock.runParams ?? undefined}
    >
      <IdentityStrip
        identity={identity}
        shownIdentity={shownIdentity}
        editing={!!dock.bench.pendingStep}
      />
      <ChartTypePicker
        active={dock.activeTile}
        recommended={dock.recommended}
        blockers={dock.blockers}
        onPick={dock.pickTile}
      />
      <ChartEncodeRow
        draft={draft}
        vis={vis}
        colNames={colNames}
        targetCol={targetCol}
        moreOpen={moreOpen}
        moreCount={moreOptionCount(draft, vis)}
        patch={patch}
        onToggleMore={() => setMoreOpen((o) => !o)}
      />
      {moreOpen ? (
        <ChartMoreForm
          draft={draft}
          vis={vis}
          colNames={colNames}
          targetCol={targetCol}
          patch={patch}
        />
      ) : null}
      <ChartRunStatus ready={dock.ready} error={dock.error} result={dock.result} />
      <ChartSavedBar draft={draft} saved={dock.saved} />
    </div>
  );
}
