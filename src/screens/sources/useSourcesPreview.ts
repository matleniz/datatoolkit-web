import { useEffect } from "react";
import { apiClient } from "../../api/client";
import {
  engineMessage,
  targetFromPreviewColumns,
  yLabelValueColumn,
  type WorkspaceBuildResult,
  type WorkspaceSourcesState,
} from "./sourcesLogic";
import { keyJoinReport, type PreviewState } from "./sourcesScreenLogic";
import type { SourcesCore } from "./useSourcesState";

type PreviewInputs = Pick<
  WorkspaceSourcesState,
  "files" | "roles" | "labelMode" | "targetCol"
>;

/** Target column the preview resolves to (engine columns, y file, then pick). */
function resolvePreviewTarget(
  res: { columns: string[] },
  src: PreviewInputs,
  buildResult: WorkspaceBuildResult,
): string | null {
  const { files, roles, labelMode, targetCol } = src;
  const trainX = files.find((f) => roles[f.id] === "trainX");
  const fromPreview = targetFromPreviewColumns(res.columns, trainX?.cols ?? []);
  const fallback =
    labelMode === "yfile"
      ? yLabelValueColumn(
          files.find((f) => roles[f.id] === "trainY")?.cols ?? [],
        )
      : targetCol;
  return fromPreview ?? fallback ?? buildResult.targetLabel;
}

/** Match report of the key join, from label_join_preview on the two label sources. */
function useKeyJoinReport(
  core: SourcesCore,
  buildResult: WorkspaceBuildResult,
): void {
  const { setPreview } = core;
  const { pushError } = core.errors;
  const ws = buildResult.workspace;
  const key = ws.label.mode === "key" ? (ws.label.key ?? null) : null;
  const x = ws.datasets.train.x;
  const y = ws.datasets.train.y;
  const ready = key !== null && Boolean(y?.path) && buildResult.errors.length === 0;

  useEffect(() => {
    let active = true;
    const set = (keyJoin: PreviewState["keyJoin"]) =>
      setPreview((prev) => ({ ...prev, keyJoin }));
    if (!ready || key === null || !y) {
      set(null);
      return;
    }
    apiClient
      .runKey("label_join_preview", { x, y, key_columns: [key] })
      .then((res) => {
        if (active) set(keyJoinReport(res, key));
      })
      .catch((err: unknown) => {
        if (!active) return;
        set(null);
        pushError(engineMessage(err));
      });
    return () => {
      active = false;
    };
  }, [ready, key, x, y, setPreview, pushError]);
}

/** Compute live preview shapes / columns and engine errors. */
export function useSourcesPreview(
  core: SourcesCore,
  buildResult: WorkspaceBuildResult,
): void {
  const { dispatch, setPreview, src } = core;
  const { setEngineErrors, pushError } = core.errors;
  const { files, labelMode, roles, targetCol } = src;

  useKeyJoinReport(core, buildResult);

  useEffect(() => {
    let active = true;
    const ws = buildResult.workspace;
    const patchPreview = (p: Partial<PreviewState>) =>
      setPreview((prev) => ({ ...prev, ...p }));

    if (buildResult.errors.length > 0) {
      setEngineErrors(buildResult.errors);
      patchPreview({ columns: null, target: null });
      return;
    }

    setEngineErrors([]);

    apiClient
      .previewWorkspace(ws, "train", 5)
      .then((res) => {
        if (!active) return;
        const resolved = resolvePreviewTarget(
          res,
          { files, roles, labelMode, targetCol },
          buildResult,
        );
        patchPreview({ trainShape: res.shape, columns: res.columns, target: resolved });
        if (resolved) {
          dispatch({ type: "SET_TARGET_COLUMN", name: resolved });
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        patchPreview({ columns: null, target: buildResult.targetLabel });
        pushError(engineMessage(err));
      });

    if (ws.datasets.test?.x) {
      apiClient
        .previewWorkspace(ws, "test", 5)
        .then((res) => {
          if (active) patchPreview({ testShape: res.shape });
        })
        .catch((err: unknown) => {
          if (active) pushError(engineMessage(err));
        });
    } else {
      patchPreview({ testShape: null });
    }

    return () => {
      active = false;
    };
  }, [
    buildResult,
    dispatch,
    files,
    labelMode,
    roles,
    targetCol,
    setPreview,
    setEngineErrors,
    pushError,
  ]);
}
