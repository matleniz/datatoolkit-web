import { PendingRegion, Skeleton } from "../../placeholder/Skeleton";
import type { SourceFileItem, WorkspaceSourcesState } from "./sourcesLogic";

interface SourcesMergeCardProps {
  mergeFile: SourceFileItem | undefined;
  commonMergeCols: string[];
  mergeKey: WorkspaceSourcesState["mergeKey"];
  mergeInTest: boolean;
  /** The files are being inspected: the key candidates are a placeholder. */
  loading: boolean;
  infoText: string | undefined;
  patch: (
    p: (s: WorkspaceSourcesState) => Partial<WorkspaceSourcesState>,
  ) => void;
}

export function SourcesMergeCard({
  mergeFile,
  commonMergeCols,
  mergeKey,
  mergeInTest,
  loading,
  infoText,
  patch,
}: SourcesMergeCardProps) {
  return (
    <section className="sources-card-padded" aria-label="Merge settings">
      <div className="sources-card-title">Merge</div>
      {mergeFile ? (
        <>
          <div style={{ fontSize: "12px", color: "var(--dtk-muted)" }}>
            Left join{" "}
            <strong
              style={{
                fontFamily: "var(--dtk-font-mono)",
                color: "var(--dtk-ink)",
              }}
            >
              {mergeFile.name}
            </strong>{" "}
            on key
          </div>
          <div className="chips-row res-chips">
            {loading && commonMergeCols.length === 0 ? (
              <PendingRegion label="Reading the merge key candidates">
                <Skeleton width={96} height={24} radius={4} />
              </PendingRegion>
            ) : null}
            {commonMergeCols.map((col) => {
              const isSelected = mergeKey === col;
              return (
                <button
                  key={col}
                  type="button"
                  className={`chip-mono ${isSelected ? "on" : ""}`}
                  aria-pressed={isSelected}
                  onClick={() => patch(() => ({ mergeKey: col }))}
                >
                  {col}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              className={`chip-select ${mergeInTest ? "on" : ""}`}
              aria-pressed={mergeInTest}
              onClick={() => patch(() => ({ mergeInTest: !mergeInTest }))}
            >
              Also merge into test: {mergeInTest ? "yes" : "no"}
            </button>
          </div>
          <div className="label-info success">{infoText}</div>
        </>
      ) : (
        <div
          style={{
            fontSize: "12px",
            color: "var(--dtk-muted)",
            lineHeight: 1.5,
          }}
        >
          Give a file the role “Merge” to join extra columns (one row per key)
          onto train and test.
        </div>
      )}
    </section>
  );
}
