import { useCallback, useEffect } from "react";
import { rememberWorkspaceName, forgetWorkspaceName } from "../../bootstrap";
import { apiClient } from "../../api/client";
import type { Workspace } from "../../api/types";
import {
  markWorkspaceSaved,
  abandonPendingWorkspaceSave,
} from "../../state/AppStore";
import {
  allowWorkspaceSave,
  markWorkspaceLoaded,
} from "../../state/workspaceSaveGate";
import {
  emptyWorkspaceSources,
  engineMessage,
  type WorkspaceSourcesState,
} from "./sourcesLogic";
import {
  cacheMatchesWorkspace,
  emptyWorkspace,
  enrichFileItem,
  isUnknownWorkspaceError,
  sourcesFromWorkspace,
  storedSourcesToLoad,
} from "./sourcesScreenLogic";
import type { SourcesCore } from "./useSourcesState";

type SourcesCache = Record<string, WorkspaceSourcesState>;

/** Resolve the sources of a selected workspace (cache, stored files, fallback). */
function useLoadWorkspaceSources(core: SourcesCore) {
  const { applySources, dispatch, activeNameRef, selectGenRef } = core;
  const { setEngineErrors } = core.errors;

  return useCallback(
    async (
      name: string,
      ws: Workspace | null,
      cache: SourcesCache,
      gen: number,
    ) => {
      const stillCurrent = () =>
        gen === selectGenRef.current && activeNameRef.current === name;

      const cached = cache[name];
      if (cacheMatchesWorkspace(cached, ws)) {
        if (!stillCurrent()) return;
        applySources(cached);
        return;
      }
      if (ws && ws.datasets.train.x.path) {
        const base = sourcesFromWorkspace(ws);
        try {
          const enriched = await Promise.all(
            base.files.map((f) => enrichFileItem(f)),
          );
          if (!stillCurrent()) return;
          const next = { ...base, files: enriched };
          applySources(next);
          dispatch({ type: "SET_WORKSPACE_FILES", name, sources: next });
        } catch (err: unknown) {
          if (!stillCurrent()) return;
          applySources(base);
          setEngineErrors([engineMessage(err)]);
        }
        return;
      }
      if (!stillCurrent()) return;
      const empty = emptyWorkspaceSources();
      applySources(empty);
      dispatch({ type: "SET_WORKSPACE_FILES", name, sources: empty });
    },
    [applySources, dispatch, activeNameRef, selectGenRef, setEngineErrors],
  );
}

/**
 * On mount, load the active workspace's stored files when the cache does not
 * describe them (fresh session: the demo churn seeded by bootstrap.ts), so the
 * screen and "Open workbench" use the stored paths (datatoolkit-issues#123).
 */
function useLoadStoredSourcesOnMount(
  core: SourcesCore,
  loadWorkspaceSources: ReturnType<typeof useLoadWorkspaceSources>,
) {
  const { activeWsName, filesByWorkspace, workspace, selectGenRef } = core;
  const { setSourcesLoading } = core;
  useEffect(() => {
    const ws = storedSourcesToLoad(activeWsName, filesByWorkspace, workspace);
    if (!ws) return;
    const gen = ++selectGenRef.current;
    void loadWorkspaceSources(ws.name, ws, filesByWorkspace, gen).finally(() => {
      if (gen === selectGenRef.current) setSourcesLoading(false);
    });
    // Mount only: later switches go through `select`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export interface SourcesWorkspaceActions {
  select: (name: string) => Promise<void>;
  create: (name: string) => void;
  renamed: (oldName: string, ws: Workspace) => void;
  duplicated: (ws: Workspace) => void;
  activeRemoved: (deletedNames: string[], fallback: string | null) => void;
  exportWorkspace: (name: string) => Promise<void>;
}

/** Workspace sidebar handlers: select / create / rename / delete / export. */
export function useSourcesWorkspaces(core: SourcesCore): SourcesWorkspaceActions {
  const {
    dispatch,
    workspace,
    filesByWorkspace,
    summaries,
    activeWsName,
    setActiveWsName,
    src,
    applySources,
    setSourcesLoading,
    persistSkip,
    activeNameRef,
    selectGenRef,
  } = core;
  const { setEngineErrors, guarded } = core.errors;
  const loadWorkspaceSources = useLoadWorkspaceSources(core);
  useLoadStoredSourcesOnMount(core, loadWorkspaceSources);

  /** Make `name` the active workspace and clear the previous one's files. */
  const adopt = (name: string) => {
    persistSkip.current = true;
    activeNameRef.current = name;
    setActiveWsName(name);
  };

  /**
   * Stored workspace, null when it only exists in the sidebar so far, or
   * undefined when a newer select superseded this one.
   */
  const fetchStored = async (
    name: string,
    gen: number,
  ): Promise<Workspace | null | undefined> => {
    const listed = summaries.some((w) => w.name === name);
    const onDisk =
      listed ||
      (await apiClient.listWorkspaceSummaries()).some((w) => w.name === name);
    if (gen !== selectGenRef.current) return undefined;
    return onDisk ? apiClient.getWorkspace(name) : null;
  };

  const select = async (name: string) => {
    const previous = activeWsName;
    const previousSources = src;
    if (previous !== name) {
      dispatch({
        type: "SET_WORKSPACE_FILES",
        name: previous,
        sources: previousSources,
      });
    }
    const gen = ++selectGenRef.current;
    adopt(name);
    setSourcesLoading(true);
    allowWorkspaceSave(name);
    // Clear immediately so previous workspace files cannot leak into the UI
    // or be re-persisted under the new name while we await the engine.
    applySources(emptyWorkspaceSources());

    const cacheAfterSave: SourcesCache = {
      ...filesByWorkspace,
      ...(previous !== name ? { [previous]: previousSources } : {}),
    };

    try {
      const ws = await fetchStored(name, gen);
      if (ws === undefined || gen !== selectGenRef.current) return;
      // Already in the store: no echo PUT that a delete would have to race.
      if (ws) markWorkspaceLoaded(ws);
      dispatch({ type: "SET_WORKSPACE", workspace: ws ?? emptyWorkspace(name) });
      rememberWorkspaceName(name);
      await loadWorkspaceSources(name, ws, cacheAfterSave, gen);
    } catch (err: unknown) {
      if (gen !== selectGenRef.current) return;
      dispatch({ type: "SET_WORKSPACE", workspace: emptyWorkspace(name) });
      const msg = engineMessage(err);
      if (!isUnknownWorkspaceError(msg)) {
        setEngineErrors([msg]);
      }
      await loadWorkspaceSources(name, null, cacheAfterSave, gen);
    } finally {
      if (gen === selectGenRef.current) {
        setSourcesLoading(false);
      }
    }
  };

  const create = (name: string) => {
    dispatch({
      type: "SET_WORKSPACE_FILES",
      name: activeWsName,
      sources: src,
    });
    allowWorkspaceSave(name);
    dispatch({ type: "SET_WORKSPACE", workspace: emptyWorkspace(name) });
    const empty = emptyWorkspaceSources();
    dispatch({ type: "SET_WORKSPACE_FILES", name, sources: empty });
    adopt(name);
    applySources(empty);
    rememberWorkspaceName(name);
  };

  const renamed = (oldName: string, ws: Workspace) => {
    // Invalidate any in-flight select of the old name (e.g. auto-select after
    // duplicate still loading when the user renames immediately).
    selectGenRef.current += 1;
    void abandonPendingWorkspaceSave([oldName]);
    const cached = filesByWorkspace[oldName] ??
      (oldName === activeWsName ? src : null);
    dispatch({ type: "CLEAR_WORKSPACE_FILES", name: oldName });
    if (cached) {
      dispatch({
        type: "SET_WORKSPACE_FILES",
        name: ws.name,
        sources: cached,
      });
    }
    if (oldName === activeWsName || workspace?.name === oldName) {
      adopt(ws.name);
      allowWorkspaceSave(ws.name);
      dispatch({ type: "SET_WORKSPACE", workspace: ws });
      markWorkspaceSaved(ws);
      rememberWorkspaceName(ws.name);
      if (cached) applySources(cached);
    }
  };

  const duplicated = (ws: Workspace) => {
    void select(ws.name);
  };

  const activeRemoved = (deletedNames: string[], fallback: string | null) => {
    void abandonPendingWorkspaceSave(deletedNames);
    for (const name of deletedNames) {
      dispatch({ type: "CLEAR_WORKSPACE_FILES", name });
      forgetWorkspaceName(name);
    }
    const activeGone =
      deletedNames.includes(activeWsName) ||
      (workspace?.name != null && deletedNames.includes(workspace.name));
    if (!activeGone) return;

    dispatch({ type: "SET_WORKSPACE", workspace: null });
    persistSkip.current = true;
    if (fallback) {
      void select(fallback);
    } else {
      activeNameRef.current = "";
      setActiveWsName("");
      applySources(emptyWorkspaceSources());
    }
  };

  const exportWorkspace = async (name: string) => {
    await guarded(async () => {
      if (name !== activeWsName) {
        await select(name);
      }
      const ws = await apiClient.getWorkspace(name);
      void abandonPendingWorkspaceSave();
      dispatch({ type: "SET_WORKSPACE", workspace: ws });
      markWorkspaceSaved(ws);
      rememberWorkspaceName(name);
      dispatch({ type: "SET_SCREEN", screen: "bench" });
      dispatch({ type: "SET_SHOW_EXPORT", show: true });
    });
  };

  return { select, create, renamed, duplicated, activeRemoved, exportWorkspace };
}
