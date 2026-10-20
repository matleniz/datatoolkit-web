import { useEffect, useRef, useState, type Dispatch } from "react";

import type { Group } from "../../api/types";
import type { AppAction } from "../../state/reducer";
import { contiguousRowSteps } from "../../state/stepGroups";

/** The open name form: a new group over the ticked rows, or a rename. */
export type GroupFormState =
  | { kind: "group" }
  | { kind: "rename"; id: string; name: string; intent: string };

/**
 * State of manual grouping in the pipeline bar (datatoolkit-issues#249): the
 * select mode (a "Group rows" button, so a plain list shows no checkbox), the rows ticked (by group id; a singleton is a row too), the open
 * form, and where the focus goes back once it closes or the grouping lands.
 */
export function useGroupEditing(groups: Group[], dispatch: Dispatch<AppAction>) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [form, setForm] = useState<GroupFormState | null>(null);
  const refocus = useRef<string | null>(null);
  // A row that went away (undo, remove) leaves the selection.
  const live = [...picked].filter((id) => groups.some((g) => g.id === id));
  if (live.length !== picked.size) setPicked(new Set(live));
  const canSelect = groups.length >= 2;
  if (selecting && !canSelect) setSelecting(false);
  const pickedSteps = contiguousRowSteps(groups, picked);

  const firstStepOf = (ids: Iterable<string>): string | null => {
    const wanted = new Set(ids);
    return groups.find((g) => wanted.has(g.id))?.step_ids[0] ?? null;
  };
  useEffect(() => {
    if (form || !refocus.current) return;
    const row = document.querySelector(`[data-row-first-step="${CSS.escape(refocus.current)}"]`);
    refocus.current = null;
    row?.querySelector<HTMLElement>("button")?.focus();
  });
  const submitForm = (name: string, intent: string) => {
    if (!form) return;
    if (form.kind === "group") {
      refocus.current = firstStepOf(picked);
      dispatch({ type: "GROUP_ROWS", groupIds: [...picked], name, intent });
      setPicked(new Set());
      setSelecting(false);
    } else {
      refocus.current = firstStepOf([form.id]);
      dispatch({ type: "RENAME_GROUP", id: form.id, name, intent });
    }
    setForm(null);
  };
  return { selecting, setSelecting, canSelect, picked, setPicked, form, setForm, refocus, pickedSteps, firstStepOf, submitForm };
}
