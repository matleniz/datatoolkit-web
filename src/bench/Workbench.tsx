import { ContextMenu } from "./contextmenu/ContextMenu";
import { Dock } from "./dock/Dock";
import { StepEditor } from "./editor/StepEditor";
import { ExportPanel } from "./export/ExportPanel";
import { Grid } from "./grid/Grid";
import { Inspector } from "./inspector/Inspector";
import { LeftPanel } from "./left/LeftPanel";
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
  const { editor, dock } = useAppState();
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
          {editor ? <StepEditor /> : <Inspector />}
          <ToolRail />
        </div>
        <ContextMenu />
      </div>
    </WorkbenchDataProvider>
  );
}
