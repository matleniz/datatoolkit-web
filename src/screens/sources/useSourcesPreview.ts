import { useEffect } from "react";
import { apiClient } from "../../api/client";
import {
  engineMessage,
  targetFromPreviewColumns,
  yLabelValueColumn,
  type WorkspaceBuildResult,
  type WorkspaceSourcesState,
} from "./sourcesLogic";
import type { PreviewState } from "./sourcesScreenLogic";
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

/** Compute live preview shapes / columns and engine errors. */
export function useSourcesPreview(
  core: SourcesCore,
  buildResult: WorkspaceBuildResult,
): void {
  const { dispatch, setPreview, src } = core;
  const { setEngineErrors, pushError } = core.errors;
  const { files, labelMode, roles, targetCol } = src;

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
