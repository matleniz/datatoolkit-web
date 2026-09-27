import { useAppState } from "../state/AppStore";
import { ContextMenu } from "./contextmenu/ContextMenu";
import { Dock } from "./dock/Dock";
import { StepEditor } from "./editor/StepEditor";
import { ExportPanel } from "./export/ExportPanel";
import { Grid } from "./grid/Grid";
import { Inspector } from "./inspector/Inspector";
import { LeftPanel } from "./left/LeftPanel";
import { PipelineBar } from "./pipeline/PipelineBar";
import { ToolRail } from "./toolrail/ToolRail";
import "./Workbench.css";

/**
 * Workbench shell — region sizes match the prototype.
 * Owners: W2 = pipeline/grid/inspector/editor/contextmenu;
 * W3 = left/dock/export/toolrail.
 */
export function Workbench() {
  const { editor } = useAppState();

  return (
    <div className="workbench" aria-label="Workbench">
      <PipelineBar />
      <div className="workbench-body">
        <LeftPanel />
        <main className="workbench-main">
          <ExportPanel />
          <div className="workbench-grid-area">
            <Grid />
            <Dock />
          </div>
        </main>
        {editor ? <StepEditor /> : <Inspector />}
        <ToolRail />
      </div>
      <ContextMenu />
    </div>
  );
}
