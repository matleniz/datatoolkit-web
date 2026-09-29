export type PanelSide = "left" | "right";
/** `true` = collapsed to a thin strip. */
export type PanelsState = Record<PanelSide, boolean>;

const KEY = "dtk.panels";

/** Collapsed side panels survive reloads (MAT-232); per browser, not per workspace. */
export function loadPanels(): PanelsState {
  const open: PanelsState = { left: false, right: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return open;
    const o: unknown = JSON.parse(raw);
    if (typeof o !== "object" || o === null) return open;
    const r = o as Record<string, unknown>;
    return { left: r.left === true, right: r.right === true };
  } catch {
    return open;
  }
}

export function savePanels(panels: PanelsState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(panels));
  } catch {
    /* private mode / quota */
  }
}
