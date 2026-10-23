import { useEffect, useId, useMemo, useRef } from "react";
import { BusyIndicator } from "../../BusyIndicator";
import { useInFlight } from "../../useInFlight";
import {
  getCommonColumns,
  buildWorkspaceJson,
  effectiveJoinKey,
  resultSchemaColumns,
} from "./sourcesLogic";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { SourcesFilesCard } from "./SourcesFilesCard";
import { SourcesTargetCard } from "./SourcesTargetCard";
import { SourcesMergeCard } from "./SourcesMergeCard";
import { SourcesResultCard } from "./SourcesResultCard";
import {
  columnOrigin,
  sourcesSpecKey,
  sourcesWorkspaceToSync,
  targetInfoText,
  targetInfoTone,
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
  const { files, roles, labelMode, yJoin, yKey, targetCol, mergeKey, mergeInTest } = src;
  const steps = workspace?.steps;
  const groups = workspace?.groups;
  const charts = workspace?.charts;
  const notes = workspace?.notes;
  const memory = workspace?.memory;
  const documents = workspace?.documents;
  const labelLast = workspace?.label_last;
  return useMemo(
    () =>
      buildWorkspaceJson({
        name: activeWsName,
        files,
        roles,
        labelMode,
        yJoin,
        yKey,
        targetCol,
        mergeKey,
        mergeInTest,
        steps: steps ?? [],
        groups: groups ?? [],
        charts: charts ?? [],
        carry: { notes, memory, documents, label_last: labelLast },
      }),
    [
      activeWsName,
      files,
      roles,
      labelMode,
      yJoin,
      yKey,
      targetCol,
      mergeKey,
      mergeInTest,
      steps,
      groups,
      charts,
      notes,
      memory,
      documents,
      labelLast,
    ],
  );
}

export function SourcesScreen() {
  const fileInputId = useId();
  const core = useSourcesState();
  const sourceBusy = useInFlight("source") > 0;
  const { src, patch, preview, activeWsName, sourcesLoading } = core;
  const { files, roles, labelMode, yJoin, yKey, targetCol, mergeKey, mergeInTest } = src;

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
  const joinKey = effectiveJoinKey(commonYCols, yKey);
  const commonMergeCols =
    trainXFile && mergeFile
      ? getCommonColumns(trainXFile.cols, mergeFile.cols)
      : [];
  /** Effective merge key: explicit pick, else first common column (matches build). */
  const effectiveMergeKey = mergeKey ?? commonMergeCols[0] ?? null;
  const resolvedTarget = preview.target ?? buildResult.targetLabel ?? null;

  const status = trainStatus(trainXFile, preview, sourcesLoading);
  // Persist Sources edits as they happen (#234): hand the built workspace to
  // the store; AppStore's debounced autosave PUTs it.
  const { dispatch, workspace: storeWorkspace } = core;
  // What loading a stored workspace built: not a user edit (no write-back).
  const baseline = useRef<{ name: string; baseline: { loaded: string; stored: string } | null } | null>(null);
  useEffect(() => {
    if (!status.canNavigate || storeWorkspace?.name !== activeWsName) return;
    if (baseline.current?.name !== activeWsName) {
      baseline.current = {
        name: activeWsName,
        baseline: storeWorkspace.datasets.train.x.path
          ? {
              loaded: sourcesSpecKey(buildResult.workspace),
              stored: sourcesSpecKey(storeWorkspace),
            }
          : null,
      };
    }
    const spec = sourcesWorkspaceToSync({
      built: buildResult.workspace,
      current: storeWorkspace,
      canNavigate: status.canNavigate,
      buildErrors: buildResult.errors,
      baseline: baseline.current.baseline,
    });
    if (!spec) return;
    dispatch({ type: "SET_SOURCES_SPEC", name: activeWsName, ...spec });
  }, [buildResult, storeWorkspace, status.canNavigate, activeWsName, dispatch]);

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
        onRetryList={core.reloadList}
        onSelect={(name) => void workspaces.select(name)}
        onSummariesChange={core.setSummaries}
        onCreated={workspaces.create}
        onActiveRemoved={workspaces.activeRemoved}
        onRenamed={workspaces.renamed}
        onDuplicated={workspaces.duplicated}
        onExport={(name) => void workspaces.exportWorkspace(name)}
        onError={core.errors.addError}
      />

      <main className="sources-main" aria-busy={core.sourcesLoading || sourceBusy}>
        <div className="sources-header">
          <span className="sources-title">Sources of “{activeWsName}”</span>
          <span className="sources-subtitle">
            Roles were guessed from the file names. Check them: changes are saved
            as you make them.
          </span>
        </div>

        <BusyIndicator scope="source" label="Loading the dataset…" />

        <SourcesFilesCard
          files={files}
          roles={roles}
          guessedMap={src.guessedMap}
          optionsOpen={core.optionsOpen}
          optionsBusy={core.optionsBusy}
          optionsNotice={core.optionsNotice}
          fileInputId={fileInputId}
          fileInputRef={core.fileInputRef}
          uploadError={core.uploadError}
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
            joinKey={joinKey}
            resolvedTarget={resolvedTarget}
            labelLast={core.workspace?.label_last ?? false}
            onLabelLast={(value) => core.dispatch({ type: "SET_LABEL_LAST", value })}
            infoText={targetInfoText(
              buildResult,
              labelMode,
              Boolean(trainYFile),
              resolvedTarget,
              preview.keyJoin,
            )}
            infoTone={targetInfoTone(labelMode, Boolean(trainYFile), resolvedTarget)}
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
