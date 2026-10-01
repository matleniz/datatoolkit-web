import { useEffect, useRef } from "react";

import { useAppDispatch } from "../../state/AppStore";

export interface StepMenuState {
  index: number;
  x: number;
  y: number;
}

/**
 * Right-click menu of a pipeline step node (datatoolkit-issues#10): Edit step
 * (reopens the editor pre-filled) and, when allowed, Remove step.
 */
export function StepMenu({
  menu,
  title,
  canDelete,
  onClose,
}: {
  menu: StepMenuState;
  title: string;
  canDelete: boolean;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // No blocking backdrop: the same click still reaches what is underneath.
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Step menu"
      className="ctx-menu step-menu"
      style={{ left: Math.round(menu.x), top: Math.round(menu.y) }}
    >
      <div className="ctx-title">{title}</div>
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        onClick={run(() => dispatch({ type: "EDIT_STEP", index: menu.index }))}
      >
        Edit step
      </button>
      {canDelete ? (
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={run(() => dispatch({ type: "REMOVE_STEP", index: menu.index }))}
        >
          Remove step
        </button>
      ) : null}
    </div>
  );
}
