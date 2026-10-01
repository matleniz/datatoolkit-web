import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { loadInitialWorkspace } from "./bootstrap";
import { AppProvider, useAppDispatch } from "./state/AppStore";
import { markWorkspaceLoaded } from "./state/workspaceSaveGate";
import "./theme/tokens.css";

function Bootstrap({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadInitialWorkspace()
      .then((ws) => {
        if (cancelled) return;
        if (ws) {
          markWorkspaceLoaded(ws);
          dispatch({ type: "SET_WORKSPACE", workspace: ws });
        }
        setReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  if (!ready) {
    return (
      <div style={{ padding: 24, color: "#5b5850" }}>
        Loading workspace…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ color: "#7d1c22", marginBottom: 8 }}>
          Engine unavailable: {error}
        </div>
        <div style={{ color: "#5b5850", fontSize: 12 }}>
          Start dtk-api on port 8765, then reload. Shell UI still loads below.
        </div>
        {children}
      </div>
    );
  }
  return children;
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root missing");
}

createRoot(root).render(
  <StrictMode>
    <AppProvider>
      <Bootstrap>
        <App />
      </Bootstrap>
    </AppProvider>
  </StrictMode>,
);
