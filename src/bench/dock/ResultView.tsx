import { useEffect, useRef } from "react";

import type { Result } from "../../api/types";

/**
 * Generic Result renderer (metrics / tables / plotly figures).
 * plotly.js-dist-min is loaded lazily only when a figure is present.
 */
export function ResultView({
  result,
  showModeBar = false,
}: {
  result: Result;
  /** Chart tool: Plotly toolbar for PNG / SVG export (MAT-172). */
  showModeBar?: boolean;
}) {
  return (
    <div className="result-view">
      {Object.keys(result.metrics).length > 0 ? (
        <div className="result-metrics">
          {Object.entries(result.metrics).map(([k, v]) => (
            <div key={k} className="result-metric">
              <span className="muted">{k}</span>
              <span className="mono">{String(v)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {result.tables.map((t) => (
        <div key={t.title} className="result-table-block">
          <div className="result-table-title">{t.title}</div>
          <div className="result-table-scroll">
            <table>
              <thead>
                <tr>
                  {Object.keys(t.records[0] ?? {}).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.records.slice(0, 40).map((row, i) => (
                  <tr key={i}>
                    {Object.keys(t.records[0] ?? {}).map((h) => (
                      <td key={h} className="mono">
                        {String(row[h] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {result.figures.map((f, i) => (
        <PlotlyFigure
          key={`${f.title}-${i}`}
          title={f.title}
          plotly={f.plotly}
          showModeBar={showModeBar}
        />
      ))}
      {result.text ? <pre className="result-text">{result.text}</pre> : null}
    </div>
  );
}

const FIGURE_RESIZE_MS = 120;

function PlotlyFigure({
  title,
  plotly,
  showModeBar,
}: {
  title: string;
  plotly: Record<string, unknown>;
  showModeBar: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const Plotly = (await import("plotly.js-dist-min")).default;
      if (cancelled || !ref.current) return;
      const data = (plotly.data as object[]) ?? [];
      const layout = {
        ...((plotly.layout as object) ?? {}),
        margin: { t: 28, r: 12, b: 32, l: 40 },
        height: showModeBar ? 280 : 220,
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: { size: 10, family: "IBM Plex Sans, sans-serif" },
      };
      await Plotly.newPlot(ref.current, data, layout, {
        displayModeBar: showModeBar,
        displaylogo: false,
        responsive: true,
        modeBarButtonsToRemove: showModeBar
          ? ["lasso2d", "select2d", "autoScale2d"]
          : undefined,
        toImageButtonOptions: showModeBar
          ? { format: "png", filename: title || "chart" }
          : undefined,
      });
    })().catch(() => {
      /* figure render is best-effort */
    });
    return () => {
      cancelled = true;
    };
  }, [plotly, showModeBar, title]);

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
    <div className="result-figure">
      <div className="result-table-title">{title}</div>
      <div ref={ref} />
    </div>
  );
}
