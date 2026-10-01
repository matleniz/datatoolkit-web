import type { SourceFileItem, WorkspaceSourcesState } from "./sourcesLogic";

type Patch = (
  p: (s: WorkspaceSourcesState) => Partial<WorkspaceSourcesState>,
) => void;

const MUTED_LABEL = { fontSize: "12px", color: "var(--dtk-muted)" } as const;

interface SourcesTargetCardProps {
  labelMode: WorkspaceSourcesState["labelMode"];
  yJoin: WorkspaceSourcesState["yJoin"];
  targetCol: WorkspaceSourcesState["targetCol"];
  trainXFile: SourceFileItem | undefined;
  trainYFile: SourceFileItem | undefined;
  commonYCols: string[];
  resolvedTarget: string | null;
  infoText: string;
  patch: Patch;
}

function YFileOptions({
  yJoin,
  trainYFile,
  commonYCols,
  resolvedTarget,
  patch,
}: Pick<
  SourcesTargetCardProps,
  "yJoin" | "trainYFile" | "commonYCols" | "resolvedTarget" | "patch"
>) {
  return (
    <>
      <div style={MUTED_LABEL}>Join y onto train X</div>
      <div className="chips-row">
        <button
          type="button"
          className={`chip-select ${yJoin === "order" ? "on" : ""}`}
          aria-pressed={yJoin === "order"}
          onClick={() => patch(() => ({ yJoin: "order" }))}
          title="y has one value column and the same row count"
        >
          By row order
        </button>
        <button
          type="button"
          className={`chip-select ${yJoin === "key" ? "on" : ""}`}
          aria-pressed={yJoin === "key"}
          disabled={commonYCols.length === 0}
          onClick={() => patch(() => ({ yJoin: "key" }))}
          title={
            commonYCols.length === 0
              ? `${trainYFile?.name || "y file"} has no column in common with train X`
              : "Join by common key"
          }
        >
          By key column
        </button>
      </div>
      {resolvedTarget ? (
        <div
          style={{
            fontSize: "12px",
            fontFamily: "var(--dtk-font-mono)",
            color: "var(--dtk-ink)",
          }}
        >
          Label column: {resolvedTarget}
        </div>
      ) : null}
    </>
  );
}

function ColumnTargetOptions({
  trainXFile,
  targetCol,
  patch,
}: Pick<SourcesTargetCardProps, "trainXFile" | "targetCol" | "patch">) {
  return (
    <>
      <div style={MUTED_LABEL}>Which column of train X is the target?</div>
      <div className="chips-row">
        {trainXFile?.cols.map((col) => {
          const isSelected = targetCol === col;
          return (
            <button
              key={col}
              type="button"
              className={`chip-mono ${isSelected ? "on" : ""}`}
              aria-pressed={isSelected}
              onClick={() => patch(() => ({ targetCol: col }))}
            >
              {col}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function SourcesTargetCard(props: SourcesTargetCardProps) {
  const { labelMode, resolvedTarget, infoText, patch } = props;
  return (
    <section className="sources-card-padded" aria-label="Target settings">
      <div className="sources-card-title">Target</div>
      <div className="chips-row">
        <button
          type="button"
          className={`chip-select ${labelMode === "yfile" ? "on" : ""}`}
          aria-pressed={labelMode === "yfile"}
          onClick={() => patch(() => ({ labelMode: "yfile" }))}
        >
          Separate y file
        </button>
        <button
          type="button"
          className={`chip-select ${labelMode === "column" ? "on" : ""}`}
          aria-pressed={labelMode === "column"}
          onClick={() => patch(() => ({ labelMode: "column" }))}
        >
          Column in train X
        </button>
      </div>

      {labelMode === "yfile" ? (
        <YFileOptions {...props} />
      ) : (
        <ColumnTargetOptions {...props} />
      )}

      <div className={`label-info ${resolvedTarget ? "success" : "error"}`}>
        {infoText}
      </div>
    </section>
  );
}
