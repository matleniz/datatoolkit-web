import type { ReactNode } from "react";

import {
  CHART_TILES,
  type ChartTileId,
} from "./chartPicker";

const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const DOT = { fill: "currentColor", stroke: "none" };

/** Inline SVG glyph per tile (no icon dependency, MAT-240). */
function TileIcon({ id }: { id: ChartTileId }) {
  let body: ReactNode;
  switch (id) {
    case "histogram":
      body = (
        <>
          <path d="M3 20h18" />
          <path d="M4 20v-5h3v5M7 20v-9h3v9M10 20V6h3v14M13 20V9h3v11M16 20v-6h3v6" />
        </>
      );
      break;
    case "box":
      body = (
        <>
          <path d="M8 3v3M8 18v3M16 5v4M16 17v2" />
          <rect x="5" y="6" width="6" height="12" rx="0.5" />
          <rect x="13" y="9" width="6" height="8" rx="0.5" />
          <path d="M5 11h6M13 13h6" />
        </>
      );
      break;
    case "violin":
      body = (
        <>
          <path d="M8 3c-3 4 -3 6 -1 9c-3 4 -2 7 1 9c3 -2 4 -5 1 -9c2 -3 2 -5 -1 -9z" />
          <path d="M16 6c-2.5 3 -2.5 5 -.5 7c-2 2.5 -1.5 4.5 .5 6c2 -1.5 2.5 -3.5 .5 -6c2 -2 2 -4 -.5 -7z" />
        </>
      );
      break;
    case "bar":
      body = (
        <>
          <path d="M3 20h18" />
          <rect x="5" y="11" width="3.5" height="9" />
          <rect x="10.25" y="5" width="3.5" height="15" />
          <rect x="15.5" y="14" width="3.5" height="6" />
        </>
      );
      break;
    case "scatter":
      body = (
        <>
          <path d="M3 3v18h18" />
          <circle cx="7.5" cy="16" r="1.4" {...DOT} />
          <circle cx="10" cy="12.5" r="1.4" {...DOT} />
          <circle cx="13" cy="14" r="1.4" {...DOT} />
          <circle cx="14.5" cy="9" r="1.4" {...DOT} />
          <circle cx="18" cy="6.5" r="1.4" {...DOT} />
          <circle cx="17.5" cy="11" r="1.4" {...DOT} />
        </>
      );
      break;
    case "line":
      body = (
        <>
          <path d="M3 3v18h18" />
          <path d="M6 16l4-5 3 3 6-8" />
        </>
      );
      break;
    case "heatmap":
      body = (
        <>
          <rect x="4" y="4" width="16" height="16" rx="1" />
          <rect x="4" y="4" width="5.33" height="5.33" {...DOT} opacity="0.25" />
          <rect x="9.33" y="9.33" width="5.33" height="5.33" {...DOT} opacity="0.9" />
          <rect x="14.66" y="4" width="5.33" height="5.33" {...DOT} opacity="0.5" />
          <rect x="4" y="14.66" width="5.33" height="5.33" {...DOT} opacity="0.6" />
          <rect x="14.66" y="14.66" width="5.33" height="5.33" {...DOT} opacity="0.3" />
        </>
      );
      break;
    case "pie":
      body = (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 12V3.5M12 12l7.4 4.2M12 12l-6.8 5" />
        </>
      );
      break;
    case "scatter_matrix":
      body = (
        <>
          <rect x="3.5" y="3.5" width="7.5" height="7.5" />
          <rect x="13" y="3.5" width="7.5" height="7.5" />
          <rect x="3.5" y="13" width="7.5" height="7.5" />
          <rect x="13" y="13" width="7.5" height="7.5" />
          <circle cx="15.5" cy="8" r="0.9" {...DOT} />
          <circle cx="18" cy="6" r="0.9" {...DOT} />
          <circle cx="6" cy="17.5" r="0.9" {...DOT} />
          <circle cx="8.5" cy="15.5" r="0.9" {...DOT} />
          <path d="M5 9.5l4.5-4.5M14.5 19l4.5-4.5" />
        </>
      );
      break;
  }
  return <svg {...ICON_PROPS}>{body}</svg>;
}

/**
 * Chart type as a grid of icon tiles (MAT-240). Tiles the columns in play
 * cannot feed stay visible but greyed, their hover text says what is missing
 * (Tableau "Show Me"); the recommended one carries a dot.
 */
export function ChartTypePicker({
  active,
  recommended,
  blockers,
  onPick,
}: {
  active: ChartTileId;
  recommended: ChartTileId | null;
  blockers: Partial<Record<ChartTileId, string>>;
  onPick: (tile: ChartTileId) => void;
}) {
  return (
    <div className="chart-tiles" role="radiogroup" aria-label="Chart type">
      {CHART_TILES.map((t) => {
        const blocker = blockers[t.id];
        const on = t.id === active;
        const rec = t.id === recommended;
        const title = blocker
          ? `${t.label}: ${blocker}`
          : rec
            ? `${t.label} (recommended for these columns)`
            : t.label;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            className="chart-tile"
            aria-checked={on}
            aria-disabled={blocker ? true : undefined}
            aria-label={t.label}
            title={title}
            data-chart-tile={t.id}
            data-recommended={rec ? "1" : undefined}
            onClick={() => {
              if (!blocker && !on) onPick(t.id);
            }}
          >
            <TileIcon id={t.id} />
            <span className="chart-tile-label">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
