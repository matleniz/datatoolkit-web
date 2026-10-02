import type { ChangeEvent } from "react";
import { apiClient } from "../../api/client";
import type { FileSourceSpec } from "../../api/types";
import { markWorkspaceSaved } from "../../state/AppStore";
import {
  engineMessage,
  formatDetectedFromSpec,
  mapFileInspect,
  type FileRole,
  type SourceFileItem,
  type WorkspaceBuildResult,
} from "./sourcesLogic";
import {
  EMPTY_TRAIN_MESSAGE,
  clearedByOptionsEdit,
  clearedByReinspect,
  enrichFileItem,
  inspectUploadedFile,
  isEmptyUpload,
  opensOptionsByDefault,
  storedSourceFailedMessage,
  trainParseErrorDisplay,
  type TrainStatus,
} from "./sourcesScreenLogic";
import type { SourcesCore } from "./useSourcesState";

export interface SourcesFileActions {
  pickRole: (fileId: string, role: FileRole) => void;
  toggleOptions: (fileId: string) => void;
  upload: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  specOptionsChange: (fileId: string, spec: FileSourceSpec) => void;
  openTrainOptions: () => void;
  reinspectTrain: () => Promise<void>;
  replaceTrainFile: () => void;
  saveAndNavigate: (screen: "align" | "bench") => Promise<void>;
}

interface FileActionsInput {
  core: SourcesCore;
  trainXFile: SourceFileItem | undefined;
  buildResult: WorkspaceBuildResult;
  status: TrainStatus;
  resolvedTarget: string | null;
}

/** Re-inspect a stored train file: new spec, columns, shape. */
async function reinspectedItem(
  trainXFile: SourceFileItem,
  path: string,
): Promise<SourceFileItem | { error: string }> {
  const inspectRes = await apiClient.runKey("file_inspect", { path });
  const mapped = mapFileInspect(inspectRes);
  if (mapped.error || !mapped.spec) {
    return { error: mapped.error ?? `file_inspect failed for ${trainXFile.name}.` };
  }
  const nextSpec: FileSourceSpec = mapped.spec.path
    ? mapped.spec
    : { ...mapped.spec, path };
  return enrichFileItem({
    ...trainXFile,
    path,
    spec: nextSpec,
    sheets: mapped.sheets,
    recordPaths: mapped.recordPaths,
    detected: mapped.detected,
    parseError: null,
    cols: [],
  });
}

/** Per-file handlers: roles, Options panel, upload, recovery, save. */
export function useSourcesFiles({
  core,
  trainXFile,
  buildResult,
  status,
  resolvedTarget,
}: FileActionsInput): SourcesFileActions {
  const {
    dispatch,
    activeWsName,
    src,
    patch,
    setSummaries,
    sourcesLoading,
    setOptionsOpen,
    setOptionsBusy,
    fileInputRef,
    optionsGenRef,
  } = core;
  const { pushError, addError, dropErrors, guarded } = core.errors;

  const pickRole = (fileId: string, role: FileRole) => {
    patch((s) => ({
      roles: { ...s.roles, [fileId]: role },
      guessedMap: { ...s.guessedMap, [fileId]: false },
    }));
  };

  const toggleOptions = (fileId: string) =>
    setOptionsOpen((prev) => ({ ...prev, [fileId]: !prev[fileId] }));

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await guarded(async () => {
      const uploadRes = await apiClient.upload(file.name, file);
      const res = await inspectUploadedFile(
        file,
        uploadRes.path,
        src.roles,
      );
      if ("error" in res) {
        pushError(res.error);
        return;
      }
      const { item, role, parseError, colCount } = res;
      patch((s) => ({
        files: [...s.files, item],
        roles: { ...s.roles, [item.id]: role },
        guessedMap: { ...s.guessedMap, [item.id]: true },
      }));
      if (opensOptionsByDefault(item.spec, parseError, colCount)) {
        setOptionsOpen((prev) => ({ ...prev, [item.id]: true }));
      }
      if (isEmptyUpload(file, parseError, colCount)) {
        addError(EMPTY_TRAIN_MESSAGE);
      }
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const specOptionsChange = (fileId: string, nextSpec: FileSourceSpec) => {
    const gen = (optionsGenRef.current[fileId] ?? 0) + 1;
    optionsGenRef.current[fileId] = gen;
    const current = src.files.find((f) => f.id === fileId);
    if (!current) return;
    const isLatest = () => optionsGenRef.current[fileId] === gen;
    setOptionsBusy((prev) => ({ ...prev, [fileId]: true }));
    const patchFile = (p: Partial<SourceFileItem>) =>
      patch((s) => ({
        files: s.files.map((f) => (f.id === fileId ? { ...f, ...p } : f)),
      }));
    patchFile({ spec: nextSpec, detected: formatDetectedFromSpec(nextSpec, null) });

    void (async () => {
      try {
        const { spec, cols, rowCount, detected, parseError } =
          await enrichFileItem({ ...current, spec: nextSpec });
        if (!isLatest()) return;
        patchFile({ spec, cols, rowCount, detected, parseError });
        const cleared = clearedByOptionsEdit(
          current.parseError,
          parseError,
          cols.length > 0,
        );
        if (cleared) dropErrors(cleared);
      } catch (err: unknown) {
        if (isLatest()) pushError(engineMessage(err));
      } finally {
        if (isLatest()) setOptionsBusy((b) => ({ ...b, [fileId]: false }));
      }
    })();
  };

  const openTrainOptions = () => {
    if (!trainXFile) return;
    setOptionsOpen((prev) => ({ ...prev, [trainXFile.id]: true }));
  };

  const reinspectTrain = async () => {
    if (!trainXFile?.spec.path && !trainXFile?.path) return;
    const path = trainXFile.spec.path || trainXFile.path;
    await guarded(async () => {
      const enriched = await reinspectedItem(trainXFile, path);
      if ("error" in enriched) {
        pushError(enriched.error);
        return;
      }
      patch((s) => ({
        files: s.files.map((f) => (f.id === trainXFile.id ? enriched : f)),
      }));
      if (enriched.parseError) {
        pushError(storedSourceFailedMessage(enriched.parseError));
      } else {
        dropErrors(clearedByReinspect);
      }
    });
  };

  const replaceTrainFile = () => {
    if (trainXFile) {
      const { [trainXFile.id]: _role, ...restRoles } = src.roles;
      const { [trainXFile.id]: _guess, ...restGuessed } = src.guessedMap;
      patch((s) => ({
        files: s.files.filter((f) => f.id !== trainXFile.id),
        roles: restRoles,
        guessedMap: restGuessed,
      }));
    }
    fileInputRef.current?.click();
  };

  const saveAndNavigate = async (screen: "align" | "bench") => {
    // Never PUT a workspace built from an unloaded / empty sources state (MAT-149).
    if (sourcesLoading) return;
    const ws = buildResult.workspace;
    if (!ws.datasets.train.x.path || status.columnCount === 0 || status.parseError) {
      addError(
        status.parseError
          ? trainParseErrorDisplay(status.parseError)
          : EMPTY_TRAIN_MESSAGE,
      );
      return;
    }
    dispatch({
      type: "SET_WORKSPACE_FILES",
      name: activeWsName,
      sources: src,
    });
    await guarded(async () => {
      await apiClient.saveWorkspace(ws);
      markWorkspaceSaved(ws);
      try {
        setSummaries(await apiClient.listWorkspaceSummaries());
      } catch {
        /* list refresh is best-effort after save */
      }
    });
    dispatch({ type: "SET_WORKSPACE", workspace: ws });
    if (resolvedTarget) {
      dispatch({ type: "SET_TARGET_COLUMN", name: resolvedTarget });
    }
    dispatch({ type: "SET_SCREEN", screen });
  };

  return {
    pickRole,
    toggleOptions,
    upload,
    specOptionsChange,
    openTrainOptions,
    reinspectTrain,
    replaceTrainFile,
    saveAndNavigate,
  };
}
