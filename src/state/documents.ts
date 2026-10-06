import type { IdCounters, WorkspaceDocument } from "../api/types";
import { mintId } from "./idCounters";
import { noteText } from "./notes";

/**
 * Workspace documents (datatoolkit-issues#178): reference files (data
 * dictionary, protocol, paper) stored with the workspace as upload refs.
 * Never part of a frame request or of the data identity.
 */

/** Most documents per workspace (the engine refuses more). */
export const DOCUMENTS_MAX = 50;

/** `d<n>`, n above every existing `d<k>` and the workspace's counter (an id is never reused). */
export function newDocumentId(documents: readonly WorkspaceDocument[], counters?: IdCounters): string {
  return mintId("d", documents.map((d) => d.id), counters);
}

/** The document with `text` as its note (a blank text removes it). */
export function withDocumentNote(doc: WorkspaceDocument, text: string): WorkspaceDocument {
  const { note: _old, ...rest } = doc;
  const note = noteText(text);
  return note === null ? rest : { ...rest, note };
}
