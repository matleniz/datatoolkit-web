import type { DockPos, DockSize, DockState, ToolId } from "./reducer";
import { sanitizeDockLayouts, syncDockLayouts } from "./dockLayout";

const keyFor = (workspaceName: string) => `dtk.dock.${workspaceName}`;

/** What survives a reload: open windows, position, size and grid layout. */
type StoredDock = Pick<DockState, "tools" | "pos" | "size" | "layouts">;

/** Dock windows only; the rail's Transform entry opens the step picker, never a window. */
const KNOWN_TOOLS: ToolId[] = [
  "compare",
  "corr",
  "dist",
  "missing",
  "outliers",
  "target",
  "drift",
  "feature_selection",
  "chart",
];

function parseStoredDock(raw: unknown, maxTools: number): StoredDock | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.tools)) return null;
  const tools = [
    ...new Set(
      o.tools.filter((t): t is ToolId => KNOWN_TOOLS.includes(t as ToolId)),
    ),
  ].slice(-maxTools);
  const pos: DockPos = o.pos === "right" ? "right" : "bottom";
  const size: DockSize =
    o.size === "S" || o.size === "L" || o.size === "M" ? o.size : "M";
  const layouts = syncDockLayouts(
    sanitizeDockLayouts(o.layouts, KNOWN_TOOLS),
    tools,
  );
  return { tools, pos, size, layouts };
}

/** Per-workspace dock layout in browser storage (MAT-234), like saved charts. */
export function loadStoredDock(
  workspaceName: string,
  maxTools: number,
): StoredDock | null {
  try {
    const raw = localStorage.getItem(keyFor(workspaceName));
    if (!raw) return null;
    return parseStoredDock(JSON.parse(raw), maxTools);
  } catch {
    return null;
  }
}

export function saveStoredDock(workspaceName: string, dock: DockState): void {
  const stored: StoredDock = {
    tools: dock.tools,
    pos: dock.pos,
    size: dock.size,
    layouts: dock.layouts,
  };
  try {
    localStorage.setItem(keyFor(workspaceName), JSON.stringify(stored));
  } catch {
    /* private mode / quota */
  }
}
