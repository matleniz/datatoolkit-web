import type { WorkspaceDocument } from "../api/types";
import type { Ack, BridgeDeps } from "./agentCommands";
import { DOCUMENTS_MAX, newDocumentId, withDocumentNote } from "./documents";
import { NOTE_MAX } from "./notes";
import { currentIdentityKey } from "./uiContext";

/**
 * `keep_attachment` (datatoolkit-issues#178): keep a chat attachment in the
 * workspace as a document, one undoable change (toast + Undo), persisted
 * before the ack. The Studio "Keep in workspace" button runs the same
 * `keptDocument` without the agent.
 */
export interface KeepAttachmentCommand {
  type: "keep_attachment";
  workspace: string;
  attachment_id: string;
  note?: string;
}

type Parsed<T> = T | { error: string };

export function parseKeepAttachment(raw: Record<string, unknown>): Parsed<KeepAttachmentCommand> {
  if (typeof raw.workspace !== "string") return { error: "workspace must be a string" };
  if (typeof raw.attachment_id !== "string" || !raw.attachment_id) {
    return { error: "attachment_id must be a non-empty string" };
  }
  if (raw.note !== undefined && typeof raw.note !== "string") return { error: "note must be a string" };
  if (typeof raw.note === "string" && raw.note.length > NOTE_MAX) {
    return { error: `note longer than ${NOTE_MAX} characters` };
  }
  return {
    type: "keep_attachment",
    workspace: raw.workspace,
    attachment_id: raw.attachment_id,
    ...(raw.note !== undefined ? { note: raw.note as string } : {}),
  };
}

/** The pieces of an uploaded file `keptDocument` needs. */
export interface UploadedFile {
  name: string;
  path: string;
}

/**
 * The document to add for `file` next to `documents`, `{ existing }` when the
 * same upload is already one, or a refusal (`bad_command: …`).
 */
export async function keptDocument(
  documents: readonly WorkspaceDocument[],
  file: UploadedFile,
  describe: (path: string, name?: string) => Promise<Omit<WorkspaceDocument, "id">>,
  note?: string,
): Promise<WorkspaceDocument | { existing: WorkspaceDocument } | string> {
  const existing = documents.find((d) => d.path === file.path);
  if (existing) return { existing };
  if (documents.length >= DOCUMENTS_MAX) {
    return `bad_command: documents full (at most ${DOCUMENTS_MAX} per workspace)`;
  }
  const described = await describe(file.path, file.name);
  return withDocumentNote({ ...described, id: newDocumentId(documents) }, note ?? "");
}

const fail = (id: string, error: string): Ack => ({ id, ok: false, error });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runKeepAttachment(
  id: string,
  cmd: KeepAttachmentCommand,
  deps: BridgeDeps,
): Promise<Ack> {
  const open = deps.getState().workspace?.name;
  if (open !== cmd.workspace) {
    return fail(id, `stale: workspace ${JSON.stringify(cmd.workspace)} is not open in Studio (open: ${JSON.stringify(open ?? null)})`);
  }
  let file: UploadedFile | null;
  let doc: Awaited<ReturnType<typeof keptDocument>>;
  try {
    file = await deps.attachmentFile(cmd.attachment_id);
    if (!file) return fail(id, "bad_command: unknown attachment");
    const documents = deps.getState().workspace?.documents ?? [];
    doc = await keptDocument(documents, file, deps.describeDocument, cmd.note);
  } catch (e) {
    return fail(id, `save_failed: ${message(e)}`);
  }
  if (typeof doc === "string") return fail(id, doc);
  const identity = () => currentIdentityKey(deps.getState());
  // Already kept: nothing changes, nothing to undo.
  if ("existing" in doc) return { id, ok: true, identity: identity(), document_id: doc.existing.id };
  deps.dispatch({ type: "ADD_DOCUMENT", document: doc });
  try {
    await deps.settle();
  } catch (e) {
    return fail(id, `save_failed: ${message(e)}`);
  }
  deps.announce(`kept ${doc.name} in the workspace documents`, [{ type: "UNDO_STEPS" }]);
  return { id, ok: true, identity: identity(), document_id: doc.id };
}
