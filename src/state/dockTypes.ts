/**
 * Dock state types shared by the reducer, the grid layout helpers
 * (dockLayout) and the dock persistence (dockStorage). Kept apart so those
 * modules import types without importing each other in a cycle.
 */

export type DockPos = "bottom" | "right";
export type DockSize = "S" | "M" | "L";
export const TOOL_IDS = [
  "compare",
  "corr",
  "dist",
  "missing",
  "outliers",
  "target",
  "drift",
  "feature_selection",
  "chart",
  "dataset_overview",
  "duplicates",
  "inconsistencies",
  "preprocessing_advisor",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface DockRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DockLayout = Partial<Record<ToolId, DockRect>>;
export type DockLayouts = Record<DockPos, DockLayout>;

export interface DockState {
  tools: ToolId[];
  pos: DockPos;
  size: DockSize;
  maximized: ToolId | null;
  /** Grid rect per open window and dock position (MAT-234). */
  layouts: DockLayouts;
}
