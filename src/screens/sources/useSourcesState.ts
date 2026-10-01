import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { apiClient } from "../../api/client";
import type { WorkspaceSummary } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { engineMessage, type WorkspaceSourcesState } from "./sourcesLogic";
import {
  EMPTY_PREVIEW,
  initialSourcesFor,
  type PreviewState,
} from "./sourcesScreenLogic";

export type PatchSources = (
  p: (s: WorkspaceSourcesState) => Partial<WorkspaceSourcesState>,
) => void;

/** Engine-error list helpers shared by every Sources handler. */
export interface SourcesErrors {
  setEngineErrors: Dispatch<SetStateAction<string[]>>;
  pushError: (msg: string) => void;
  addError: (msg: string) => void;
  dropErrors: (drop: (e: string) => boolean) => void;
  /** Shared handler shape: run, surface any thrown engine error. */
  guarded: (fn: () => Promise<void>) => Promise<void>;
}

/** Everything the Sources handler hooks share: state, setters and refs. */
export interface SourcesCore {
  dispatch: ReturnType<typeof useAppDispatch>;
  workspace: ReturnType<typeof useAppState>["workspace"];
  filesByWorkspace: Record<string, WorkspaceSourcesState>;
  summaries: WorkspaceSummary[];
  setSummaries: Dispatch<SetStateAction<WorkspaceSummary[]>>;
  listError: string | null;
  activeWsName: string;
  setActiveWsName: Dispatch<SetStateAction<string>>;
  src: WorkspaceSourcesState;
  patch: PatchSources;
  applySources: (next: WorkspaceSourcesState) => void;
  preview: PreviewState;
  setPreview: Dispatch<SetStateAction<PreviewState>>;
  engineErrors: string[];
  errors: SourcesErrors;
  /** True while a workspace switch is still loading sources (MAT-149). */
  sourcesLoading: boolean;
  setSourcesLoading: Dispatch<SetStateAction<boolean>>;
  /** File ids with the Options panel open. */
  optionsOpen: Record<string, boolean>;
  setOptionsOpen: Dispatch<SetStateAction<Record<string, boolean>>>;
  /** File ids currently re-previewing after an Options edit. */
  optionsBusy: Record<string, boolean>;
  setOptionsBusy: Dispatch<SetStateAction<Record<string, boolean>>>;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  optionsGenRef: MutableRefObject<Record<string, number>>;
  persistSkip: MutableRefObject<boolean>;
  activeNameRef: MutableRefObject<string>;
  /** Bumps on each workspace select so stale loadWorkspaceSources results are ignored. */
  selectGenRef: MutableRefObject<number>;
}

function useSourcesErrors(): [string[], SourcesErrors] {
  const [engineErrors, setEngineErrors] = useState<string[]>([]);
  const pushError = useCallback(
    (msg: string) => setEngineErrors((prev) => [...prev, msg]),
    [],
  );
  const addError = useCallback(
    (msg: string) =>
      setEngineErrors((prev) => (prev.includes(msg) ? prev : [...prev, msg])),
    [],
  );
  const dropErrors = useCallback(
    (drop: (e: string) => boolean) =>
      setEngineErrors((prev) => prev.filter((e) => !drop(e))),
    [],
  );
  const guarded = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err: unknown) {
        pushError(engineMessage(err));
      }
    },
    [pushError],
  );
  return [
    engineErrors,
    { setEngineErrors, pushError, addError, dropErrors, guarded },
  ];
}

/** Load workspace summaries on mount. */
function useWorkspaceSummaries() {
  const [summaries, setSummaries] = useState<WorkspaceSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    apiClient
      .listWorkspaceSummaries()
      .then((list) => {
        if (!active) return;
        setSummaries(list);
        setListError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setListError(engineMessage(err));
      });
    return () => {
      active = false;
    };
  }, []);
  return { summaries, setSummaries, listError };
}

/** State, refs and persistence shared by the Sources screen handlers. */
export function useSourcesState(): SourcesCore {
  const { workspace, filesByWorkspace } = useAppState();
  const dispatch = useAppDispatch();

  const [activeWsName, setActiveWsName] = useState<string>(
    workspace?.name ?? "churn",
  );

  const initialSources = useMemo(
    () => initialSourcesFor(activeWsName, filesByWorkspace),
    [activeWsName, filesByWorkspace],
  );

  const [src, setSrc] = useState<WorkspaceSourcesState>(initialSources);
  const patch = useCallback<PatchSources>(
    (p) => setSrc((s) => ({ ...s, ...p(s) })),
    [],
  );

  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const [engineErrors, errors] = useSourcesErrors();
  const { setEngineErrors } = errors;
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState<Record<string, boolean>>({});
  const [optionsBusy, setOptionsBusy] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const optionsGenRef = useRef<Record<string, number>>({});
  const persistSkip = useRef(true);
  const activeNameRef = useRef(activeWsName);
  activeNameRef.current = activeWsName;
  const selectGenRef = useRef(0);

  const applySources = useCallback(
    (next: WorkspaceSourcesState) => {
      setSrc(next);
      setPreview(EMPTY_PREVIEW);
      setEngineErrors([]);
    },
    [setEngineErrors],
  );

  // Persist Sources UI state for the *current* workspace only.
  // Do not depend on activeWsName — switching must not re-save the previous
  // files under the new name (race while awaiting getWorkspace).
  useEffect(() => {
    if (persistSkip.current) {
      persistSkip.current = false;
      return;
    }
    dispatch({
      type: "SET_WORKSPACE_FILES",
      name: activeNameRef.current,
      sources: src,
    });
  }, [src, dispatch]);

  const { summaries, setSummaries, listError } = useWorkspaceSummaries();

  return {
    dispatch,
    workspace,
    filesByWorkspace,
    summaries,
    setSummaries,
    listError,
    activeWsName,
    setActiveWsName,
    src,
    patch,
    applySources,
    preview,
    setPreview,
    engineErrors,
    errors,
    sourcesLoading,
    setSourcesLoading,
    optionsOpen,
    setOptionsOpen,
    optionsBusy,
    setOptionsBusy,
    fileInputRef,
    optionsGenRef,
    persistSkip,
    activeNameRef,
    selectGenRef,
  };
}
