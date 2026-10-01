import { useEffect } from "react";

import { useAppDispatch, useAppState } from "../../state/AppStore";

/** Keyboard shortcuts stay with text fields (their own undo) and the step editor. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Ctrl/Cmd+Z → undo; Shift+Ctrl/Cmd+Z or Ctrl+Y → redo; else null. */
function historyKey(e: KeyboardEvent): "UNDO_STEPS" | "REDO_STEPS" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "REDO_STEPS" : "UNDO_STEPS";
  if (key === "y" && !e.shiftKey) return "REDO_STEPS";
  return null;
}

function UndoIcon({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <path
        d="M4.5 2.5L1.5 5.5l3 3M1.8 5.5h6.7a4 4 0 010 8H6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Undo / redo over the pipeline's steps (datatoolkit-issues#16): add, remove
 * and alignment-step changes. Disabled while a step is being edited.
 */
export function PipelineHistory() {
  const { stepHistory, editor, screen } = useAppState();
  const dispatch = useAppDispatch();
  const canUndo = !editor && stepHistory.past.length > 0;
  const canRedo = !editor && stepHistory.future.length > 0;

  useEffect(() => {
    if (screen !== "bench") return;
    const onKey = (e: KeyboardEvent) => {
      const type = historyKey(e);
      if (!type || isTextField(e.target)) return;
      e.preventDefault();
      dispatch({ type });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, dispatch]);

  return (
    <div className="pipeline-history" role="group" aria-label="Pipeline history">
      <button
        type="button"
        className="pipeline-history-btn"
        aria-label="Undo pipeline change"
        title="Undo the last pipeline change (Ctrl/Cmd+Z)"
        disabled={!canUndo}
        onClick={() => dispatch({ type: "UNDO_STEPS" })}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="pipeline-history-btn"
        aria-label="Redo pipeline change"
        title="Redo (Shift+Ctrl/Cmd+Z)"
        disabled={!canRedo}
        onClick={() => dispatch({ type: "REDO_STEPS" })}
      >
        <UndoIcon flip />
      </button>
    </div>
  );
}
