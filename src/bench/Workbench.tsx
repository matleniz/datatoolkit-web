import { AgentPanel } from "./agent/panel/AgentPanel";
import { TerminalPanel } from "./agent/terminal/TerminalPanel";
import { ContextMenu } from "./contextmenu/ContextMenu";
import { Dock } from "./dock/Dock";
import { StepEditor } from "./editor/StepEditor";
import { ExportPanel } from "./export/ExportPanel";
import { Grid } from "./grid/Grid";
import { Inspector } from "./inspector/Inspector";
import { LeftPanel } from "./left/LeftPanel";
import { PanelToggle } from "./PanelToggle";
import { PipelineBar } from "./pipeline/PipelineBar";
import { ToolRail } from "./toolrail/ToolRail";
import { WorkbenchDataProvider } from "./WorkbenchData";
import { useAppState } from "../state/AppStore";
import "./Workbench.css";

/**
 * Workbench shell — region sizes match the prototype.
 * Owners: W2 = pipeline/grid/inspector/editor/contextmenu;
 * W3 = left/dock/export/toolrail.
 */
export function Workbench() {
  const { editor, dock, panels } = useAppState();
  const dockOpen = dock.tools.length > 0;
  const maximized = !!(dock.maximized && dock.tools.includes(dock.maximized));
  const right = dock.pos === "right" && dockOpen;
  const showGrid = !(maximized && dockOpen);

  return (
    <WorkbenchDataProvider>
      <div className="workbench" aria-label="Workbench">
        <PipelineBar />
        <div className="workbench-body">
          <LeftPanel />
          <main className="workbench-main">
            <ExportPanel />
            <div
              className={
                right ? "workbench-grid-area row" : "workbench-grid-area"
              }
            >
              {showGrid ? <Grid /> : null}
              <Dock />
            </div>
          </main>
          {/* An open step editor is never collapsed: unapplied edits stay put. */}
          {panels.right && !editor ? (
            <div className="side-strip right">
              <PanelToggle side="right" collapsed label="inspector" />
            </div>
          ) : (
            <div className="side-slot right">
              <div className="side-head">
                <PanelToggle
                  side="right"
                  collapsed={false}
                  label={editor ? "step editor" : "inspector"}
                  disabledReason={
                    editor
                      ? "Apply or discard the step edit before collapsing"
                      : undefined
                  }
                />
              </div>
              {editor ? <StepEditor /> : <Inspector />}
            </div>
          )}
          <AgentPanel />
          <TerminalPanel />
          <ToolRail />
        </div>
        <ContextMenu />
      </div>
    </WorkbenchDataProvider>
  );
}
