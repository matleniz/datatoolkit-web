import { useId, useMemo } from "react";
import { getCommonColumns, buildWorkspaceJson, resultSchemaColumns } from "./sourcesLogic";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { SourcesFilesCard } from "./SourcesFilesCard";
import { SourcesTargetCard } from "./SourcesTargetCard";
import { SourcesMergeCard } from "./SourcesMergeCard";
import { SourcesResultCard } from "./SourcesResultCard";
import {
  columnOrigin,
  targetInfoText,
  testShapeText,
  trainShapeText,
  trainStatus,
} from "./sourcesScreenLogic";
import { useSourcesState, type SourcesCore } from "./useSourcesState";
import { useSourcesPreview } from "./useSourcesPreview";
import { useSourcesWorkspaces } from "./useSourcesWorkspaces";
import { useSourcesFiles } from "./useSourcesFiles";
import "./sources.css";

/** Workspace JSON candidate built from the current Sources choices. */
function useBuildResult(core: SourcesCore) {
  const { activeWsName, workspace, src } = core;
  const { files, roles, labelMode, yJoin, targetCol, mergeKey, mergeInTest } = src;
  const steps = workspace?.steps;
  const charts = workspace?.charts;
  return useMemo(
    () =>
      buildWorkspaceJson({
        name: activeWsName,
        files,
        roles,
        labelMode,
        yJoin,
        targetCol,
        mergeKey,
        mergeInTest,
        steps: steps ?? [],
        charts: charts ?? [],
      }),
    [
      activeWsName,
      files,
      roles,
      labelMode,
      yJoin,
      targetCol,
      mergeKey,
      mergeInTest,
      steps,
      charts,
    ],
  );
}

export function SourcesScreen() {
  const fileInputId = useId();
  const core = useSourcesState();
  const { src, patch, preview, activeWsName, sourcesLoading } = core;
  const { files, roles, labelMode, yJoin, targetCol, mergeKey, mergeInTest } = src;

  const buildResult = useBuildResult(core);
  useSourcesPreview(core, buildResult);
  const workspaces = useSourcesWorkspaces(core);

  const fileWithRole = (role: string) => files.find((f) => roles[f.id] === role);
  const trainXFile = fileWithRole("trainX");
  const trainYFile = fileWithRole("trainY");
  const mergeFile = fileWithRole("merge");
  const testFile = fileWithRole("testX");

  const commonYCols =
    trainXFile && trainYFile
      ? getCommonColumns(trainXFile.cols, trainYFile.cols)
      : [];
  const commonMergeCols =
    trainXFile && mergeFile
      ? getCommonColumns(trainXFile.cols, mergeFile.cols)
      : [];
  /** Effective merge key: explicit pick, else first common column (matches build). */
  const effectiveMergeKey = mergeKey ?? commonMergeCols[0] ?? null;
  const resolvedTarget = preview.target ?? buildResult.targetLabel ?? null;

  const status = trainStatus(trainXFile, preview, sourcesLoading);
  const fileActions = useSourcesFiles({
    core,
    trainXFile,
    buildResult,
    status,
    resolvedTarget,
  });

  // Prefer engine preview columns so Index from y is not duplicated and
  // only the real label column appears as target. Always union merge extras
  // once a merge key is chosen (MAT-155 item 5).
  const displayedCols = resultSchemaColumns({
    previewColumns: preview.columns,
    trainXCols: trainXFile?.cols ?? [],
    yCols: trainYFile?.cols ?? [],
    labelMode,
    mergeCols: mergeFile?.cols ?? [],
    mergeKey: effectiveMergeKey,
  });

  return (
    <div className="sources-layout" aria-label="Sources screen">
      <WorkspaceSidebar
        summaries={core.summaries}
        activeName={activeWsName}
        listError={core.listError}
        onSelect={(name) => void workspaces.select(name)}
        onSummariesChange={core.setSummaries}
        onCreated={workspaces.create}
        onActiveRemoved={workspaces.activeRemoved}
        onRenamed={workspaces.renamed}
        onDuplicated={workspaces.duplicated}
        onExport={(name) => void workspaces.exportWorkspace(name)}
        onError={core.errors.addError}
      />

      <main className="sources-main">
        <div className="sources-header">
          <span className="sources-title">Sources of “{activeWsName}”</span>
          <span className="sources-subtitle">
            Roles were guessed from the file names. Check them: nothing is loaded
            until you continue.
          </span>
        </div>

        <SourcesFilesCard
          files={files}
          roles={roles}
          guessedMap={src.guessedMap}
          optionsOpen={core.optionsOpen}
          optionsBusy={core.optionsBusy}
          fileInputId={fileInputId}
          fileInputRef={core.fileInputRef}
          onPickRole={fileActions.pickRole}
          onToggleOptions={fileActions.toggleOptions}
          onSpecChange={fileActions.specOptionsChange}
          onUpload={(e) => void fileActions.upload(e)}
        />

        <div className="two-col-grid">
          <SourcesTargetCard
            labelMode={labelMode}
            yJoin={yJoin}
            targetCol={targetCol}
            trainXFile={trainXFile}
            trainYFile={trainYFile}
            commonYCols={commonYCols}
            resolvedTarget={resolvedTarget}
            infoText={targetInfoText(
              buildResult,
              labelMode,
              Boolean(trainYFile),
              resolvedTarget,
            )}
            patch={patch}
          />
          <SourcesMergeCard
            mergeFile={mergeFile}
            commonMergeCols={commonMergeCols}
            mergeKey={mergeKey}
            mergeInTest={mergeInTest}
            infoText={buildResult.info.merge}
            patch={patch}
          />
        </div>

        <SourcesResultCard
          trainShapeText={trainShapeText(
            preview,
            src,
            trainXFile,
            trainYFile,
            mergeFile,
          )}
          testShapeText={testShapeText(preview, src, testFile, mergeFile)}
          displayedCols={displayedCols}
          resolvedTarget={resolvedTarget}
          originFor={(col) =>
            columnOrigin(
              col,
              buildResult,
              resolvedTarget,
              mergeFile,
              effectiveMergeKey,
            )
          }
          engineErrors={core.engineErrors}
          status={status}
          trainXFile={trainXFile}
          onReinspect={() => void fileActions.reinspectTrain()}
          onOpenTrainOptions={fileActions.openTrainOptions}
          onReplaceTrain={fileActions.replaceTrainFile}
        />

        <div className="sources-actions">
          <button
            type="button"
            className="btn-primary-action"
            disabled={!status.canNavigate}
            title={status.navigateBlockReason}
            onClick={() => void fileActions.saveAndNavigate("align")}
          >
            Check train / test alignment →
          </button>
          <button
            type="button"
            className="btn-secondary-action"
            disabled={!status.canNavigate}
            title={status.navigateBlockReason}
            onClick={() => void fileActions.saveAndNavigate("bench")}
          >
            Open workbench
          </button>
        </div>
      </main>
    </div>
  );
}
