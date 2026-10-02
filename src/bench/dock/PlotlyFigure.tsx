import { useEffect, useRef } from "react";

import { dockFigureLayout, type PlotPoint } from "./figureDisplay";

const FIGURE_RESIZE_MS = 120;

/** Plotly's event mixin on a plotted element. */
type PlotEl = HTMLDivElement & {
  on?: (event: string, fn: (ev: { points?: PlotPoint[] }) => void) => void;
  removeAllListeners?: (event: string) => void;
};

export const DTK_COLORWAY = [
  "#1d5b86", // --dtk-accent
  "#b4460f", // --dtk-stage-clean
  "#2f6b3a", // --dtk-stage-select
  "#6b5ea8", // --dtk-stage-import
  "#a8844a", // category/kind warm
  "#4e3a8a", // --dtk-outlier-fg
  "#8fb0c9", // --dtk-kind-num
  "#b3a6d6", // --dtk-kind-date
];

/**
 * Replace Plotly default blues (#636efa) with DTK accent, aligning colors
 * with src/theme/tokens.css purely on the front-end layout/template without recalculation.
 */
function applyDtkColorsToData(data: object[]): object[] {
  return data.map((item) => {
    if (typeof item !== "object" || item === null) return item;
    const trace = { ...(item as Record<string, unknown>) };
    const marker = trace.marker as Record<string, unknown> | undefined;
    if (marker && typeof marker === "object") {
      const color = marker.color;
      if (typeof color === "string" && color.toLowerCase() === "#636efa") {
        trace.marker = { ...marker, color: DTK_COLORWAY[0] };
      } else if (Array.isArray(color)) {
        trace.marker = {
          ...marker,
          color: color.map((c) =>
            typeof c === "string" && c.toLowerCase() === "#636efa"
              ? DTK_COLORWAY[0]
              : c,
          ),
        };
      }
    }
    const line = trace.line as Record<string, unknown> | undefined;
    if (line && typeof line === "object") {
      if (typeof line.color === "string" && line.color.toLowerCase() === "#636efa") {
        trace.line = { ...line, color: DTK_COLORWAY[0] };
      }
    }
    return trace;
  });
}

/**
 * One engine Plotly figure, sized by its container (MAT-235): the parent box
 * decides the height (the window fills), the plot follows window and grid
 * resizes (MAT-234). Mode bar visible on hover only (MAT-246).
 * Theme colors aligned with tokens.css.
 * plotly.js-dist-min is loaded lazily.
 */
export function PlotlyFigure({
  title,
  plotly,
  onPointClick,
}: {
  title: string;
  plotly: Record<string, unknown>;
  /** Click-through (e.g. select the clicked column in the grid). */
  onPointClick?: (point: PlotPoint, ev: MouseEvent | undefined) => void;
}) {
  const ref = useRef<PlotEl>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const Plotly = (await import("plotly.js-dist-min")).default;
      const el = ref.current;
      const box = boxRef.current;
      if (cancelled || !el) return;
      const rawData = (plotly.data as object[]) ?? [];
      const data = applyDtkColorsToData(rawData);
      const rawLayout = dockFigureLayout(
        (plotly.layout as Record<string, unknown>) ?? {},
        rawData.length,
      );
      const withLegend = Boolean(rawLayout.legend);
      const template = (rawLayout.template as Record<string, unknown>) ?? {};
      const templateLayout = (template.layout as Record<string, unknown>) ?? {};
      const targetHeight =
        box && box.clientHeight > 0 ? box.clientHeight : el.clientHeight > 0 ? el.clientHeight : 180;
      const targetWidth =
        box && box.clientWidth > 0 ? box.clientWidth : el.clientWidth > 0 ? el.clientWidth : undefined;
      const layout = {
        ...rawLayout,
        autosize: true,
        height: targetHeight,
        width: targetWidth,
        margin: {
          t: withLegend ? 40 : 16,
          r: 10,
          b: 28,
          l: 36,
        },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: {
          size: 10,
          family: "IBM Plex Sans, sans-serif",
          color: "#1c1b18",
          ...((rawLayout.font as Record<string, unknown>) ?? {}),
        },
        colorway: DTK_COLORWAY,
        template: {
          ...template,
          layout: {
            ...templateLayout,
            colorway: DTK_COLORWAY,
          },
        },
      };
      await Plotly.newPlot(el, data, layout, {
        displayModeBar: "hover",
        displaylogo: false,
        responsive: true,
        modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
        toImageButtonOptions: { format: "png", filename: title || "chart" },
      });
      if (cancelled) return;
      el.removeAllListeners?.("plotly_click");
      el.on?.("plotly_click", (ev) => {
        const pt = ev.points?.[0];
        const native = (ev as { event?: MouseEvent }).event;
        if (pt) clickRef.current?.(pt, native);
      });
    })().catch(() => {
      /* figure render is best-effort */
    });
    return () => {
      cancelled = true;
    };
  }, [plotly, title]);

  // Follow the dock window's size (MAT-234). Plotly's `responsive` only
  // listens to window resizes; relayout once the grid drag has ended, not on
  // every pixel of a resize.
  useEffect(() => {
    const el = ref.current;
    const box = boxRef.current;
    if (!el || !box || typeof ResizeObserver === "undefined") return;
    let timer: number | undefined;
    const settle = () => {
      if (el.closest(".react-grid-item.resizing")) {
        timer = window.setTimeout(settle, FIGURE_RESIZE_MS);
        return;
      }
      if (!el.classList.contains("js-plotly-plot")) return;
      const h = box.clientHeight > 0 ? box.clientHeight : el.clientHeight;
      const w = box.clientWidth > 0 ? box.clientWidth : el.clientWidth;
      void import("plotly.js-dist-min")
        .then(({ default: Plotly }) => {
          if (h > 0 && w > 0) {
            return Plotly.relayout(el, { height: h, width: w });
          }
          return Plotly.Plots.resize(el);
        })
        .catch(() => {
          /* best-effort, like the render */
        });
    };
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, FIGURE_RESIZE_MS);
    });
    ro.observe(box);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={boxRef} className="result-plot-box">
      <div ref={ref} className="result-plot" />
    </div>
  );
}
