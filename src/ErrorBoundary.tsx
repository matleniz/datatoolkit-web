import { Component, type ErrorInfo, type ReactNode } from "react";

import { getCommittedWorkspace } from "./state/workspaceSaveGate";

/** JSON of the in-memory workspace, or null when there is none or it cannot be serialized. */
function workspaceExportJson(): { name: string; json: string } | null {
  try {
    const ws = getCommittedWorkspace();
    if (!ws) return null;
    const json = JSON.stringify(ws, null, 2);
    return json ? { name: ws.name || "workspace", json } : null;
  } catch {
    return null;
  }
}

/** Download the in-memory workspace as a JSON file; false when that was not possible. */
function downloadWorkspaceJson(): boolean {
  try {
    const out = workspaceExportJson();
    if (!out) return false;
    const url = URL.createObjectURL(new Blob([out.json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${out.name.replace(/[^\w.-]+/g, "_")}.workspace.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  try {
    return error instanceof Error && error.message ? error.message : String(error);
  } catch {
    return "Unknown error";
  }
}

interface State {
  error: unknown;
  failed: boolean;
  exportNote: string | null;
}

/**
 * Catches a render exception below it (a malformed engine payload, say) and
 * shows what happened instead of a blank page, with a way to reload and a way
 * to save the in-memory workspace (#221). It sits outside `AppProvider`
 * because a reducer exception on a malformed payload is thrown by the provider
 * itself; the export reads the last committed workspace kept by the save gate,
 * not React state, so it works whatever broke. The startup error screen
 * (`BootstrapError`) is separate and unchanged.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, failed: false, exportNote: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[ui] render error", error, info.componentStack);
  }

  private exportWorkspace = () => {
    this.setState({
      exportNote: downloadWorkspaceJson()
        ? null
        : "No workspace in memory to export (or it could not be serialized).",
    });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main style={{ padding: 24, maxWidth: 640 }} data-render-error>
        <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>Something went wrong</h1>
        <div className="banner error-banner" role="alert">
          <span>The screen could not be displayed: {messageOf(this.state.error)}</span>
        </div>
        <p style={{ color: "#5b5850", fontSize: 13 }}>
          Your last edits may not be saved yet. Export the workspace as JSON to keep
          your work, then reload.
        </p>
        {this.state.exportNote ? (
          <p role="status" style={{ fontSize: 13 }}>
            {this.state.exportNote}
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button type="button" onClick={this.exportWorkspace}>
            Export workspace JSON
          </button>
        </div>
      </main>
    );
  }
}
