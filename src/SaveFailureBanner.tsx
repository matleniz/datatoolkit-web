import { useState, useSyncExternalStore } from "react";
import {
  dismissWorkspaceSaveFailure,
  getLiveSaveFailure,
  getOrphanedSaveFailures,
  retryWorkspaceSave,
  subscribeWorkspaceSaveFailure,
} from "./state/workspaceSaveGate";

/** Persistent notice while the last autosave failed (issue #218). */
export function SaveFailureBanner() {
  const failure = useSyncExternalStore(
    subscribeWorkspaceSaveFailure,
    getLiveSaveFailure,
  );
  const orphans = useSyncExternalStore(
    subscribeWorkspaceSaveFailure,
    getOrphanedSaveFailures,
  );
  const [retrying, setRetrying] = useState(false);
  if (!failure && orphans.length === 0) return null;

  const retry = () => {
    setRetrying(true);
    // A failed retry stays recorded (the message updates); nothing to rethrow.
    void retryWorkspaceSave()
      .catch(() => undefined)
      .finally(() => setRetrying(false));
  };

  return (
    <>
      {orphans.map((o) => (
        <div
          key={o.ws.name}
          className="banner error-banner"
          role="alert"
          data-save-failed="orphaned"
          data-workspace={o.ws.name}
        >
          <span>
            Not saved: edits to workspace "{o.ws.name}" were lost ({o.message})
          </span>
          <button type="button" onClick={() => dismissWorkspaceSaveFailure(o.ws.name)}>
            Dismiss
          </button>
        </div>
      ))}
      {failure ? (
        <div className="banner error-banner" role="alert" data-save-failed="">
          <span>Not saved: {failure.message}</span>
          <button type="button" disabled={retrying} onClick={retry}>
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : null}
    </>
  );
}
