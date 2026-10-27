import { CANCELLED_MESSAGE } from "../../api/types";
import { PendingRegion, Skeleton } from "../../placeholder/Skeleton";
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
  /** The sources are being inspected: nothing to show yet. */
  loading?: boolean;
  trainXFile: SourceFileItem | undefined;
  onReinspect: () => void;
  onOpenTrainOptions: () => void;
  onReplaceTrain: () => void;
}

/** While `loading`, the placeholders stand in for the "Loading…" banner. */
function ErrorBanners({
  engineErrors,
  status,
  loading,
}: Pick<SourcesResultCardProps, "engineErrors" | "status" | "loading">) {
  const { parseErrorHint, emptyTrainHint } = status;
  return (
    <>
      {/* Errors derived from columns not read yet would be false alarms. */}
      {(loading ? [] : visibleEngineErrors(engineErrors, status)).map((err, i) =>
        err === CANCELLED_MESSAGE ? (
          <div key={i} className="engine-notice-box" role="status">
            {err}
          </div>
        ) : (
          <div key={i} className="engine-error-box" role="alert">
            {err}
          </div>
        ),
      )}
      {parseErrorHint ? (
        <div
          className="engine-error-box"
          role="alert"
          data-train-parse-error="1"
        >
          {parseErrorHint}
        </div>
      ) : null}
      {!loading && showEmptyTrainBanner(status, engineErrors) ? (
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
    loading = false,
  } = props;
  // Nothing known yet: the shapes and the column chips are placeholders.
  const chipsSk = loading && displayedCols.length === 0;
  const shapeSk = (text: string) =>
    chipsSk ? <Skeleton className="res-shape-sk" width={56} height={11} /> : text;
  return (
    <section className="sources-card-padded" aria-label="Result schema">
      <div className="res-header">
        <span className="sources-card-title">Result</span>
        <span className="res-shape">
          train {shapeSk(trainShapeText)} · test {shapeSk(testShapeText)}
        </span>
      </div>

      <div className="chips-row res-chips">
        {chipsSk ? (
          <PendingRegion label="Loading the columns" className="chips-row">
            {[64, 88, 72, 96, 56, 80].map((w, i) => (
              <Skeleton key={i} width={w} height={22} radius={4} />
            ))}
          </PendingRegion>
        ) : null}
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

      <ErrorBanners engineErrors={props.engineErrors} status={status} loading={loading} />
      {status.parseErrorHint ? <RecoveryActions {...props} /> : null}
    </section>
  );
}
