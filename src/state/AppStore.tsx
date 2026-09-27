import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";

import { apiClient } from "../api/client";
import {
  appReducer,
  initialState,
  type AppAction,
  type AppState,
} from "./reducer";

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
  const saveResolve = useRef<(() => void) | null>(null);

  useEffect(() => {
    window.__DTK_DISPATCH__ = dispatch;
    window.__DTK_STATE__ = () => state;
    return () => {
      delete window.__DTK_DISPATCH__;
      delete window.__DTK_STATE__;
    };
  }, [dispatch, state]);

  // Keep the engine workspace store in sync so analysis keys that use
  // `{kind:"dataset", workspace, role}` can resolve the named workspace.
  useEffect(() => {
    const ws = state.workspace;
    if (!ws?.name || !ws.datasets.train.x.path) {
      window.__DTK_WORKSPACE_SAVED__ = Promise.resolve();
      return;
    }
    const gen = ++saveGen.current;
    let settled = false;
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const settle = () => {
      if (settled) return;
      settled = true;
      saveResolve.current = null;
      resolveGate();
    };
    window.__DTK_WORKSPACE_SAVED__ = gate;
    saveResolve.current = settle;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await apiClient.saveWorkspace(ws);
        } catch {
          /* Consumers surface engine errors on the next key/export call. */
        } finally {
          if (gen === saveGen.current) settle();
        }
      })();
    }, SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      // Flush immediately on change so waiters never hang on a cancelled debounce.
      void (async () => {
        try {
          await apiClient.saveWorkspace(ws);
        } catch {
          /* ignore */
        } finally {
          settle();
        }
      })();
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
