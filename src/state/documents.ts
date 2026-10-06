import type { WorkspaceDocument } from "../api/types";
import { noteText } from "./notes";

/**
 * Workspace documents (datatoolkit-issues#178): reference files (data
 * dictionary, protocol, paper) stored with the workspace as upload refs.
 * Never part of a frame request or of the data identity.
 */

/** Most documents per workspace (the engine refuses more). */
export const DOCUMENTS_MAX = 50;

const ID_RE = /^d(\d+)$/;

/** `d<n>`, n the smallest above every existing `d<k>`. */
export function newDocumentId(documents: readonly WorkspaceDocument[]): string {
  let top = 0;
  for (const d of documents) {
    const n = ID_RE.exec(d.id)?.[1];
    if (n !== undefined) top = Math.max(top, Number(n));
  }
  return `d${top + 1}`;
}

/** The document with `text` as its note (a blank text removes it). */
export function withDocumentNote(doc: WorkspaceDocument, text: string): WorkspaceDocument {
  const { note: _old, ...rest } = doc;
  const note = noteText(text);
  return note === null ? rest : { ...rest, note };
}
