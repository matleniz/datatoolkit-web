import { useState, useSyncExternalStore } from "react";
import {
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

  return (
    <div className="banner error-banner" role="alert" data-save-failed="">
      <span>Not saved: {failure.message}</span>
      <button type="button" disabled={retrying} onClick={retry}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
