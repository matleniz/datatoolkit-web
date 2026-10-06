import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import type { ExportFormat, ExportManifest, ExportOutputEntry } from "../../api/types";
import { errorText } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import {
  defaultExportOutDir,
  joinManifestPath,
  resolveExportOutDir,
} from "./exportPaths";
import "./ExportPanel.css";

const FIT_OPS = new Set([
  "impute",
  "scale",
  "onehot",
  "ordinal",
  "clip",
  "formula",
  "log1p",
]);

/** Format picker (#156): label, short name for the button, files written. */
const FORMATS: { id: ExportFormat; label: string; short: string; files: string }[] = [
  { id: "parquet", label: "Parquet", short: "parquet", files: "processed/train.parquet, test.parquet" },
  { id: "csv", label: "CSV", short: "CSV", files: "processed/train.csv, test.csv" },
  {
    id: "ipynb",
    label: "Notebook (.ipynb)",
    short: "notebook",
    files: "code/pipeline.ipynb · replays the steps, with the notes",
  },
  { id: "py", label: "Python script (.py)", short: "script", files: "code/pipeline.py" },
];

function outputEntries(
  outputs: ExportManifest["outputs"],
): { role: string; entry: ExportOutputEntry }[] {
  if (Array.isArray(outputs)) {
    return outputs.map((entry, i) => {
      const e = entry as ExportOutputEntry;
      const path = String(e.path ?? "");
      let role = String(i);
      if (/train\.parquet$/i.test(path)) role = "train";
      else if (/test\.parquet$/i.test(path)) role = "test";
      else if (path) role = path;
      return { role, entry: e };
    });
  }
  return Object.entries(outputs ?? {}).map(([role, entry]) => ({
    role,
    entry,
  }));
}

function countFittedSteps(steps: Record<string, unknown>[]): number {
  return steps.filter((st) => {
    const op = String(st.op ?? "");
    const target = String(st.target ?? "both");
    return FIT_OPS.has(op) && target !== "test";
  }).length;
}

/** W3 — export panel (workspace JSON + export_workspace). */
export function ExportPanel() {
  const { workspace, showExport } = useAppState();
  const dispatch = useAppDispatch();
  const [outDir, setOutDir] = useState(() =>
    workspace ? defaultExportOutDir(workspace) : "/tmp/exports",
  );
  const [manifest, setManifest] = useState<ExportManifest | null>(null);
  /** out_dir used for the last successful export (for path display). */
  const [exportedOutDir, setExportedOutDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formats, setFormats] = useState<ExportFormat[]>(["parquet"]);
  const picked = FORMATS.filter((f) => formats.includes(f.id));
  const toggleFormat = (id: ExportFormat, on: boolean) =>
    setFormats((cur) => FORMATS.map((f) => f.id).filter((f) => (f === id ? on : cur.includes(f))));

  useEffect(() => {
    if (workspace) setOutDir(defaultExportOutDir(workspace));
  }, [workspace]);

  const steps = workspace?.steps ?? [];
  const nFit = steps.filter(
    (st) => FIT_OPS.has(st.op) && st.target !== "test",
  ).length;
  const leakText = steps.length
    ? `${nFit} fitted step${nFit !== 1 ? "s" : ""} learned on train and replayed on test. Nothing is refitted on test.`
    : "No step yet.";

  const codeText = useMemo(() => {
    if (!workspace) return "// no workspace";
    return JSON.stringify(workspace, null, 2);
  }, [workspace]);

  if (!showExport) {
    return (
      <div className="export-bar" data-owner="W3">
        <span className="export-bar-spacer" />
        <button
          type="button"
          className="export-open-btn"
          onClick={() => dispatch({ type: "SET_SHOW_EXPORT", show: true })}
        >
          Export
        </button>
      </div>
    );
  }

  const outs = manifest ? outputEntries(manifest.outputs) : [];
  const fittedInManifest = manifest
    ? countFittedSteps(manifest.steps ?? [])
    : 0;
  const resolvedOutDir =
    manifest && exportedOutDir != null
      ? resolveExportOutDir(
          exportedOutDir,
          outs.map(({ entry }) => String(entry.path ?? "")),
        )
      : null;
  const manifestFile =
    resolvedOutDir != null ? joinManifestPath(resolvedOutDir) : null;

  return (
    <div className="export-panel" data-owner="W3" aria-label="Export">
      <div className="export-code-col">
        <div className="export-heading">
          <span className="export-title">Export</span>
          <span className="muted">
            workspace JSON, what save_workspace stores
          </span>
        </div>
        <pre className="export-code">{codeText}</pre>
      </div>
      <div className="export-side">
        <div
          className="export-side-scroll"
          data-export-scroll="1"
          aria-label="Export outputs"
        >
          <div className="export-side-title">Outputs</div>
          <fieldset className="export-formats">
            <legend>Formats</legend>
            {FORMATS.map((f) => (
              <label key={f.id} className="export-format" title={f.files}>
                <input
                  type="checkbox"
                  checked={formats.includes(f.id)}
                  onChange={(e) => toggleFormat(f.id, e.target.checked)}
                />
                {f.label}
              </label>
            ))}
          </fieldset>
          <div className="export-outputs mono muted">
            {picked.map((f) => (
              <span key={f.id}>
                {f.files}
                <br />
              </span>
            ))}
            manifest.json · steps, states, hashes
          </div>
          <div className="leak-line">{leakText}</div>
          <label htmlFor="export-outdir">Output directory</label>
          <input
            id="export-outdir"
            className="mono"
            value={outDir}
            onChange={(e) => setOutDir(e.target.value)}
            aria-label="Output directory"
          />
          <button
            type="button"
            className="export-run-btn"
            disabled={!workspace || busy || !outDir.trim() || picked.length === 0}
            onClick={async () => {
              if (!workspace) return;
              setBusy(true);
              setError(null);
              setManifest(null);
              setExportedOutDir(null);
              const requested = outDir.trim();
              try {
                await apiClient.saveWorkspace(workspace);
                const m = await apiClient.exportWorkspace(workspace.name, {
                  out_dir: requested,
                  overwrite: true,
                  formats,
                });
                setExportedOutDir(requested);
                setManifest(m);
              } catch (e) {
                setError(errorText(e));
                setManifest(null);
                setExportedOutDir(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            {picked.length
              ? `Export ${picked.map((f) => f.short).join(" + ")} + manifest`
              : "Pick a format"}
          </button>
          {error ? (
            <div className="engine-error" role="alert">
              {error}
            </div>
          ) : null}
          {manifest ? (
            <div className="export-manifest" aria-label="Export manifest">
              <div className="export-manifest-summary">
                <div>
                  <strong>{(manifest.steps ?? []).length}</strong> step
                  {(manifest.steps ?? []).length === 1 ? "" : "s"}
                  {" · "}
                  <strong>{fittedInManifest}</strong> fitted
                </div>
                <ul className="export-manifest-paths">
                  {resolvedOutDir != null ? (
                    <li className="mono">Output dir: {resolvedOutDir}</li>
                  ) : null}
                  {outs.map(({ role, entry }) => (
                    <li key={role} className="mono">
                      {role}: {entry.path}
                      {typeof entry.rows === "number"
                        ? ` · ${entry.rows} rows`
                        : ""}
                    </li>
                  ))}
                  {manifestFile != null ? (
                    <li className="mono">manifest: {manifestFile}</li>
                  ) : null}
                </ul>
              </div>
              <pre className="export-manifest-json">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="export-close-btn"
          onClick={() => dispatch({ type: "SET_SHOW_EXPORT", show: false })}
        >
          Close
        </button>
      </div>
    </div>
  );
}
