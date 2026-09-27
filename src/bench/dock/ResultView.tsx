import { useEffect, useRef } from "react";

import type { Result } from "../../api/types";

/**
 * Generic Result renderer (metrics / tables / plotly figures).
 * plotly.js-dist-min is loaded lazily only when a figure is present.
 */
export function ResultView({ result }: { result: Result }) {
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
        <PlotlyFigure key={`${f.title}-${i}`} title={f.title} plotly={f.plotly} />
      ))}
      {result.text ? <pre className="result-text">{result.text}</pre> : null}
    </div>
  );
}

function PlotlyFigure({
  title,
  plotly,
}: {
  title: string;
  plotly: Record<string, unknown>;
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
        height: 220,
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: { size: 10, family: "IBM Plex Sans, sans-serif" },
      };
      await Plotly.newPlot(ref.current, data, layout, {
        displayModeBar: false,
        responsive: true,
      });
    })().catch(() => {
      /* figure render is best-effort */
    });
    return () => {
      cancelled = true;
    };
  }, [plotly]);

  return (
    <div className="result-figure">
      <div className="result-table-title">{title}</div>
      <div ref={ref} />
    </div>
  );
}
