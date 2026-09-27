import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

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
  }
}

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

  useEffect(() => {
    window.__DTK_DISPATCH__ = dispatch;
    window.__DTK_STATE__ = () => state;
    return () => {
      delete window.__DTK_DISPATCH__;
      delete window.__DTK_STATE__;
    };
  }, [dispatch, state]);

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
