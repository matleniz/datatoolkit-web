import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { NOTE_MAX } from "../../state/notes";
import { usePopupPlacement } from "../placement";

export interface NoteAnchor {
  x: number;
  y: number;
}

/**
 * Edit one note (datatoolkit-issues#152): a small popover at `anchor`
 * (viewport coordinates). Save / Delete call `onSave` (Delete = ""), which
 * dispatches one undoable change; Escape, Cancel or a click outside close it.
 */
export function NotePopover({
  label,
  text,
  anchor,
  onSave,
  onClose,
  owner,
}: {
  /** What the note is on: "step 2 (impute)", "column age", "the workspace". */
  label: string;
  text: string | null;
  anchor: NoteAnchor;
  onSave: (text: string) => void;
  onClose: () => void;
  /** The button that toggles the popover: a press on it is not "outside". */
  owner?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState(text ?? "");

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || owner?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose, owner]);

  const save = (value: string) => {
    if (value !== (text ?? "")) onSave(value);
    onClose();
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save(draft);
    }
  };

  const placed = usePopupPlacement(ref, anchor);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Note on ${label}`}
      className="note-pop"
      style={{
        left: Math.round(placed?.left ?? anchor.x),
        top: Math.round(placed?.top ?? anchor.y),
        maxHeight: placed?.maxHeight,
        overflowY: "auto",
      }}
      onKeyDown={onKey}
    >
      <div className="note-pop-title">Note on {label}</div>
      <textarea
        aria-label="Note text"
        className="note-pop-text"
        value={draft}
        maxLength={NOTE_MAX}
        rows={5}
        autoFocus
        placeholder="Why this step / what this column means…"
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="note-pop-actions">
        {text ? (
          <button type="button" className="btn-secondary" onClick={() => save("")}>
            Delete
          </button>
        ) : null}
        <span className="note-pop-spacer" />
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => save(draft)}>
          Save
        </button>
      </div>
    </div>
  );
}

/** Note icon (filled when there is a note). */
export function NoteIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M2 1.5h4.2L8 3.3v5.2H2z"
        fill={filled ? "#e9d48a" : "none"}
        stroke="#5b5850"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M3.5 4.6h3M3.5 6.4h3" stroke="#5b5850" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A note button and its popover: the button shows whether a note exists and
 * its text on hover.
 */
export function NoteButton({
  label,
  text,
  className,
  onSave,
}: {
  label: string;
  text: string | null;
  className: string;
  onSave: (text: string) => void;
}) {
  const [anchor, setAnchor] = useState<NoteAnchor | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`${className}${text ? " has-note" : ""}`}
        aria-label={`Note on ${label}`}
        aria-haspopup="dialog"
        data-has-note={text ? "1" : undefined}
        title={text ?? `Add a note on ${label}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: r.left, y: r.bottom + 4 });
        }}
      >
        <NoteIcon filled={!!text} />
      </button>
      {anchor ? (
        <NotePopover
          label={label}
          text={text}
          anchor={anchor}
          onSave={onSave}
          onClose={() => setAnchor(null)}
          owner={button}
        />
      ) : null}
    </>
  );
}
