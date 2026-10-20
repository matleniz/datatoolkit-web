import { useEffect, useState, type ReactNode } from "react";

import { errorText } from "./api/types";
import { BootstrapError } from "./BootstrapError";
import { loadInitialWorkspace, skippedWorkspaceOf, type SkippedWorkspace } from "./bootstrap";
import { SkippedWorkspaceNotice } from "./SkippedWorkspaceNotice";
import { useAppDispatch } from "./state/AppStore";
import { markWorkspaceLoaded } from "./state/workspaceSaveGate";

export function Bootstrap({ children }: { children: ReactNode }) {
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
        // A skipped name from a failed earlier attempt still applies (#262).
        setSkipped((prev) => skippedWs ?? prev);
        setError(null);
        setReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        // Keep naming the skipped workspace across Retry: a retry no longer
        // has the remembered name, so it cannot find it again (#262).
        const skippedWs = skippedWorkspaceOf(e);
        if (skippedWs) setSkipped(skippedWs);
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
    return <BootstrapError error={error} onRetry={retry} skipped={skipped} />;
  }
  return (
    <>
      {skipped ? (
        <SkippedWorkspaceNotice skipped={skipped} onDismiss={() => setSkipped(null)} />
      ) : null}
      {children}
    </>
  );
}
