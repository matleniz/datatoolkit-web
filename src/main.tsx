import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { errorText } from "./api/types";
import { BootstrapError } from "./BootstrapError";
import { loadInitialWorkspace, type SkippedWorkspace } from "./bootstrap";
import { AppProvider, useAppDispatch } from "./state/AppStore";
import { markWorkspaceLoaded } from "./state/workspaceSaveGate";
import "./theme/tokens.css";

function Bootstrap({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [skipped, setSkipped] = useState<SkippedWorkspace | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadInitialWorkspace()
      .then(({ workspace: ws, skipped: skippedWs }) => {
        if (cancelled) return;
        markWorkspaceLoaded(ws);
        dispatch({ type: "SET_WORKSPACE", workspace: ws });
        setSkipped(skippedWs);
        setError(null);
        setReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(errorText(e));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch, attempt]);

  const retry = () => {
    setReady(false);
    setError(null);
    setAttempt((n) => n + 1);
  };

  if (!ready) {
    return (
      <div style={{ padding: 24, color: "#5b5850" }}>
        Loading workspace…
      </div>
    );
  }
  if (error !== null) {
    return <BootstrapError error={error} onRetry={retry} />;
  }
  return (
    <>
      {skipped ? (
        <div className="banner error-banner" role="status" data-workspace-skipped={skipped.name}>
          <span>
            {skipped.corrupt
              ? `Workspace "${skipped.name}" is unreadable (${skipped.reason}) and was not opened; opened another one instead. Delete it from the workspace list, or restore its file.`
              : `Could not open workspace "${skipped.name}" (${skipped.reason}); opened another one instead.`}
          </span>
          <button type="button" onClick={() => setSkipped(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {children}
    </>
  );
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
