import type { SourceFileItem } from "./sourcesLogic";
import {
  showEmptyTrainBanner,
  visibleEngineErrors,
  type TrainStatus,
} from "./sourcesScreenLogic";

interface SourcesResultCardProps {
  trainShapeText: string;
  testShapeText: string;
  displayedCols: string[];
  resolvedTarget: string | null;
  originFor: (col: string) => "x" | "y" | "merge";
  engineErrors: string[];
  status: TrainStatus;
  trainXFile: SourceFileItem | undefined;
  onReinspect: () => void;
  onOpenTrainOptions: () => void;
  onReplaceTrain: () => void;
}

function ErrorBanners({
  engineErrors,
  status,
}: Pick<SourcesResultCardProps, "engineErrors" | "status">) {
  const { parseErrorHint, emptyTrainHint } = status;
  return (
    <>
      {visibleEngineErrors(engineErrors, status).map((err, i) => (
        <div key={i} className="engine-error-box" role="alert">
          {err}
        </div>
      ))}
      {parseErrorHint ? (
        <div
          className="engine-error-box"
          role="alert"
          data-train-parse-error="1"
        >
          {parseErrorHint}
        </div>
      ) : null}
      {showEmptyTrainBanner(status, engineErrors) ? (
        <div className="engine-error-box" role="status">
          {emptyTrainHint}
        </div>
      ) : null}
    </>
  );
}

function RecoveryActions({
  trainXFile,
  onReinspect,
  onOpenTrainOptions,
  onReplaceTrain,
}: Pick<
  SourcesResultCardProps,
  "trainXFile" | "onReinspect" | "onOpenTrainOptions" | "onReplaceTrain"
>) {
  return (
    <div className="sources-recovery-actions" role="group">
      <button
        type="button"
        className="btn-outline-action"
        data-reinspect-train="1"
        onClick={onReinspect}
      >
        Re-inspect
      </button>
      {trainXFile?.spec.kind === "csv" ? (
        <button
          type="button"
          className="btn-outline-action"
          data-open-train-options="1"
          onClick={onOpenTrainOptions}
        >
          Options (on_bad_lines)
        </button>
      ) : null}
      <button
        type="button"
        className="btn-outline-action"
        data-replace-train="1"
        onClick={onReplaceTrain}
      >
        Replace file
      </button>
    </div>
  );
}

export function SourcesResultCard(props: SourcesResultCardProps) {
  const {
    trainShapeText,
    testShapeText,
    displayedCols,
    resolvedTarget,
    originFor,
    status,
  } = props;
  return (
    <section className="sources-card-padded" aria-label="Result schema">
      <div className="res-header">
        <span className="sources-card-title">Result</span>
        <span className="res-shape">
          train {trainShapeText} · test {testShapeText}
        </span>
      </div>

      <div className="chips-row">
        {displayedCols.map((col) => (
          <span key={col} className={`res-col-chip origin-${originFor(col)}`}>
            {col}
            {col === resolvedTarget ? " ◎" : ""}
          </span>
        ))}
      </div>

      <div className="res-legend">
        <span className="legend-x">■ X</span>
        <span className="legend-y">■ y (label)</span>
        <span className="legend-merge">■ merged</span>
      </div>

      <ErrorBanners engineErrors={props.engineErrors} status={status} />
      {status.parseErrorHint ? <RecoveryActions {...props} /> : null}
    </section>
  );
}
