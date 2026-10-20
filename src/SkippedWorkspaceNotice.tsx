import type { SkippedWorkspace } from "./bootstrap";

/** Notice naming the remembered workspace that startup did not open (#160, #164, #262). */
export function SkippedWorkspaceNotice({
  skipped,
  onDismiss,
  opened = true,
}: {
  skipped: SkippedWorkspace;
  onDismiss?: () => void;
  /** Another workspace was opened instead (false on the startup error screen). */
  opened?: boolean;
}) {
  const tail = opened ? "; opened another one instead" : "";
  return (
    <div className="banner error-banner" role="status" data-workspace-skipped={skipped.name}>
      <span>
        {skipped.corrupt
          ? `Workspace "${skipped.name}" is unreadable (${skipped.reason}) and was not opened${tail}. Delete it from the workspace list, or restore its file.`
          : `Could not open workspace "${skipped.name}" (${skipped.reason})${tail}.`}
      </span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
