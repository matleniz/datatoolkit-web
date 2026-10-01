const keyFor = (workspaceName: string) => `dtk.dismissedSuggestions.${workspaceName}`;

/** Oldest dismissals are forgotten past this many (storage stays small). */
const MAX_DISMISSED = 500;

/**
 * Dismissed suggestion ids per workspace, in browser storage
 * (datatoolkit-issues#15), like the dock layout and saved charts.
 */
export function loadDismissedSuggestions(workspaceName: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(workspaceName));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function saveDismissedSuggestions(
  workspaceName: string,
  ids: string[],
): void {
  try {
    localStorage.setItem(
      keyFor(workspaceName),
      JSON.stringify(ids.slice(-MAX_DISMISSED)),
    );
  } catch {
    /* private mode / quota */
  }
}
