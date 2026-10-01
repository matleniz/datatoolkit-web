import { useMemo, useState } from "react";

import {
  loadDismissedSuggestions,
  saveDismissedSuggestions,
} from "../../state/suggestionDismissStorage";

interface Loaded {
  name: string | undefined;
  ids: string[];
}

const load = (name: string | undefined): Loaded => ({
  name,
  ids: name ? loadDismissedSuggestions(name) : [],
});

/**
 * Dismissed suggestion ids of the open workspace (browser-local UI state,
 * datatoolkit-issues#15). Reloads when the workspace changes.
 */
export function useDismissedSuggestions(workspaceName: string | undefined): {
  dismissed: ReadonlySet<string>;
  toggle: (id: string) => void;
} {
  const [loaded, setLoaded] = useState(() => load(workspaceName));
  let current = loaded;
  if (loaded.name !== workspaceName) {
    current = load(workspaceName);
    setLoaded(current);
  }
  const { name, ids } = current;
  const dismissed = useMemo(() => new Set(ids), [ids]);

  const toggle = (id: string) => {
    if (!name) return;
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    saveDismissedSuggestions(name, next);
    setLoaded({ name, ids: next });
  };

  return { dismissed, toggle };
}
