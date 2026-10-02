import { useSyncExternalStore } from "react";

/**
 * Agent panel open / closed (rail icon toggles it). Per browser, not per
 * workspace, like the side panels (`dtk.panels`); kept out of the app reducer
 * so the panel never changes the view context or the undo history.
 */
const KEY = "dtk.agentPanel";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "open";
  } catch {
    return false;
  }
}

let open = read();

export function setAgentPanelOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  try {
    localStorage.setItem(KEY, next ? "open" : "closed");
  } catch {
    /* private mode / quota */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAgentPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
