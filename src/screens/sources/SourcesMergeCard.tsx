import type { SourceFileItem, WorkspaceSourcesState } from "./sourcesLogic";

interface SourcesMergeCardProps {
  mergeFile: SourceFileItem | undefined;
  commonMergeCols: string[];
  mergeKey: WorkspaceSourcesState["mergeKey"];
  mergeInTest: boolean;
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
          <div className="chips-row">
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
