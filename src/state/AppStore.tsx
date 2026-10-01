import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";

import { serializeWorkspace } from "../api/client";
import { rememberWorkspaceName } from "../bootstrap";
import { saveStoredCharts } from "./chartStorage";
import { saveStoredDock } from "./dockStorage";
import { savePanels } from "./panelStorage";
import {
  appReducer,
  initialState,
  type AppAction,
  type AppState,
} from "./reducer";
import {
  getLastSavedWorkspaceJson,
  getWorkspaceSaveEpoch,
  queueWorkspaceSave,
  saveable,
  setCommittedWorkspace,
} from "./workspaceSaveGate";

export {
  abandonPendingWorkspaceSave,
  ensureWorkspaceSaved,
  markWorkspaceSaved,
} from "./workspaceSaveGate";

const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);

declare global {
  interface Window {
    /** E2E / Playwright hook — dispatch store actions from the page. */
    __DTK_DISPATCH__?: Dispatch<AppAction>;
    __DTK_STATE__?: () => AppState;
    /** Resolves once the latest workspace has been PUT to the engine store. */
    __DTK_WORKSPACE_SAVED__?: Promise<void>;
  }
}

const SAVE_DEBOUNCE_MS = 250;

export function AppProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Partial<AppState>;
}) {
  const [state, dispatch] = useReducer(appReducer, {
    ...initialState,
    ...initial,
    selection: { ...initialState.selection, ...initial?.selection },
    dock: { ...initialState.dock, ...initial?.dock },
  });

  const saveGen = useRef(0);

  useEffect(() => {
    window.__DTK_DISPATCH__ = dispatch;
    window.__DTK_STATE__ = () => state;
    return () => {
      delete window.__DTK_DISPATCH__;
      delete window.__DTK_STATE__;
    };
  }, [dispatch, state]);

  // Persistence lives here, not in the reducer (which must stay pure).
  const wsName = state.workspace?.name;
  const charts = state.workspace?.charts;
  useEffect(() => savePanels(state.panels), [state.panels]);
  useEffect(() => {
    if (wsName !== undefined) saveStoredDock(wsName, state.dock);
  }, [wsName, state.dock]);
  useEffect(() => {
    if (wsName !== undefined && charts) saveStoredCharts(wsName, charts);
  }, [wsName, charts]);

  useLayoutEffect(() => {
    setCommittedWorkspace(state.workspace);
  }, [state.workspace]);

  // Keep the engine workspace store in sync so analysis keys that use
  // `{kind:"dataset", workspace, role, version}` can resolve the named
  // workspace. PUT only when the serialized JSON actually changed; consumers
  // that need the store now call `ensureWorkspaceSaved` (no debounce).
  useEffect(() => {
    const ws = state.workspace;
    if (!saveable(ws)) {
      window.__DTK_WORKSPACE_SAVED__ = Promise.resolve();
      return;
    }
    rememberWorkspaceName(ws.name);
    const serialized = serializeWorkspace(ws);
    if (serialized === getLastSavedWorkspaceJson()) {
      window.__DTK_WORKSPACE_SAVED__ = Promise.resolve();
      return;
    }

    const epochAtStart = getWorkspaceSaveEpoch();
    const gen = ++saveGen.current;
    let settled = false;
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const settle = () => {
      if (settled) return;
      settled = true;
      resolveGate();
    };
    window.__DTK_WORKSPACE_SAVED__ = gate;

    const timer = window.setTimeout(() => {
      if (gen !== saveGen.current) {
        settle();
        return;
      }
      void queueWorkspaceSave(ws, epochAtStart).finally(settle);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      if (
        settled ||
        serialized === getLastSavedWorkspaceJson() ||
        epochAtStart !== getWorkspaceSaveEpoch()
      ) {
        settle();
        return;
      }
      // Flush (MAT-149); queueWorkspaceSave skips it when a newer commit
      // superseded it or a delete/rename abandoned it (MAT-171 / MAT-217).
      void queueWorkspaceSave(ws, epochAtStart).finally(settle);
    };
  }, [state.workspace]);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState requires AppProvider");
  return ctx;
}

export function useAppDispatch(): Dispatch<AppAction> {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error("useAppDispatch requires AppProvider");
  return ctx;
}

export function useAppStore(): {
  state: AppState;
  dispatch: Dispatch<AppAction>;
} {
  const state = useAppState();
  const dispatch = useAppDispatch();
  return useMemo(() => ({ state, dispatch }), [state, dispatch]);
}

export type { AppAction, AppState };
