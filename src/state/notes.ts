import type { Step, WorkspaceNotes } from "../api/types";

/**
 * Notes on steps, columns and the workspace (datatoolkit-issues#152). Free
 * text, not data: never part of a frame request or of the data identity.
 */

/** Longest note the engine stores. */
export const NOTE_MAX = 4000;

export const EMPTY_NOTES: WorkspaceNotes = { workspace: null, columns: {} };

/** The text to store, or null for "no note" (empty / blank). */
export function noteText(text: string | null | undefined): string | null {
  return text && text.trim() !== "" ? text : null;
}

/** `step` with `text` as its note (a blank text removes it). */
export function withNote(step: Step, text: string | null | undefined): Step {
  const { note: _old, ...rest } = step;
  const note = noteText(text);
  return note === null ? rest : { ...rest, note };
}

/** Notes with the column note under `key` set (a blank text removes it). */
export function withColumnNote(
  notes: WorkspaceNotes | undefined,
  key: string,
  text: string,
): WorkspaceNotes {
  const { [key]: _old, ...columns } = (notes ?? EMPTY_NOTES).columns;
  const note = noteText(text);
  return { ...(notes ?? EMPTY_NOTES), columns: note === null ? columns : { ...columns, [key]: note } };
}

/** Notes with the workspace note set (a blank text removes it). */
export function withWorkspaceNote(notes: WorkspaceNotes | undefined, text: string): WorkspaceNotes {
  return { ...(notes ?? EMPTY_NOTES), workspace: noteText(text) };
}

/** Key a column note is stored under: its origin name when a rename moved it. */
export function columnNoteKey(name: string, keys: Record<string, string>): string {
  return keys[name] ?? name;
}
