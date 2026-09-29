import { useEffect, useRef } from "react";

import type { PlotPoint } from "./figureDisplay";

const FIGURE_RESIZE_MS = 120;

/** Plotly's event mixin on a plotted element. */
type PlotEl = HTMLDivElement & {
  on?: (event: string, fn: (ev: { points?: PlotPoint[] }) => void) => void;
  removeAllListeners?: (event: string) => void;
};

/**
 * One engine Plotly figure, sized by its container (MAT-235): the parent box
 * decides the height (the window fills), the plot follows window and grid
 * resizes (MAT-234). Mode bar (PNG / SVG export) on every figure.
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
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const Plotly = (await import("plotly.js-dist-min")).default;
      const el = ref.current;
      if (cancelled || !el) return;
      const data = (plotly.data as object[]) ?? [];
      const layout = {
        ...((plotly.layout as Record<string, unknown>) ?? {}),
        autosize: true,
        height: undefined,
        width: undefined,
        margin: { t: 24, r: 12, b: 36, l: 44 },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: { size: 10, family: "IBM Plex Sans, sans-serif" },
      };
      await Plotly.newPlot(el, data, layout, {
        displayModeBar: true,
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
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: number | undefined;
    const settle = () => {
      if (el.closest(".react-grid-item.resizing")) {
        timer = window.setTimeout(settle, FIGURE_RESIZE_MS);
        return;
      }
      if (!el.classList.contains("js-plotly-plot")) return;
      void import("plotly.js-dist-min")
        .then(({ default: Plotly }) => Plotly.Plots.resize(el))
        .catch(() => {
          /* best-effort, like the render */
        });
    };
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, FIGURE_RESIZE_MS);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="result-plot-box">
      <div ref={ref} className="result-plot" />
    </div>
  );
}
