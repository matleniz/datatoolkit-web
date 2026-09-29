import type { Result } from "../../api/types";
import { PlotlyFigure } from "./PlotlyFigure";
import { ResultTableView } from "./ResultTableView";

/**
 * Chart window's Result renderer (MAT-172): metrics line, then the figure
 * filling the window (MAT-235), then any tables. Analysis windows use
 * `AnalysisResultView` instead.
 */
export function ResultView({ result }: { result: Result }) {
  return (
    <div className="result-view result-view-chart">
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
      {result.figures.map((f, i) => (
        <div
          key={`${f.title}-${i}`}
          className="result-figure"
          data-figure-title={f.title}
        >
          <div className="result-table-title">{f.title}</div>
          <PlotlyFigure title={f.title} plotly={f.plotly} />
        </div>
      ))}
      {result.tables.map((t) => (
        <ResultTableView key={t.title} table={t} />
      ))}
      {result.text ? <pre className="result-text">{result.text}</pre> : null}
    </div>
  );
}
