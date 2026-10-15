import { useState, useSyncExternalStore } from "react";
import {
  dismissWorkspaceSaveFailure,
  getWorkspaceSaveFailure,
  retryWorkspaceSave,
  subscribeWorkspaceSaveFailure,
} from "./state/workspaceSaveGate";

/** Persistent notice while the last autosave failed (issue #218). */
export function SaveFailureBanner() {
  const failure = useSyncExternalStore(
    subscribeWorkspaceSaveFailure,
    getWorkspaceSaveFailure,
  );
  const [retrying, setRetrying] = useState(false);
  if (!failure) return null;

  const retry = () => {
    setRetrying(true);
    // A failed retry stays recorded (the message updates); nothing to rethrow.
    void retryWorkspaceSave()
      .catch(() => undefined)
      .finally(() => setRetrying(false));
  };

  if (failure.orphaned) {
    return (
      <div className="banner error-banner" role="alert" data-save-failed="orphaned">
        <span>
          Not saved: edits to workspace "{failure.ws.name}" were lost
          ({failure.message})
        </span>
        <button type="button" onClick={dismissWorkspaceSaveFailure}>
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="banner error-banner" role="alert" data-save-failed="">
      <span>Not saved: {failure.message}</span>
      <button type="button" disabled={retrying} onClick={retry}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
