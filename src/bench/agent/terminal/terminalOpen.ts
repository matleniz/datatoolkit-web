import { useSyncExternalStore } from "react";

/**
 * Terminal panel open / closed. Opt-in and never persisted: a reload starts
 * with it closed, so a CLI session only runs when the user asked for it now.
 */
const listeners = new Set<() => void>();
let open = false;

export function setTerminalPanelOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTerminalPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
