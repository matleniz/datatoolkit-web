import { useCallback, useState } from "react";

import { apiClient } from "../../../api/client";
import { useAppDispatch, useAppState } from "../../../state/AppStore";
import { keptDocument } from "../../../state/documentCommands";
import { saveable } from "../../../state/workspaceSaveGate";
import { listAttachments } from "./attachmentContract";

/**
 * "Keep in workspace" on a chat attachment (datatoolkit-issues#178): the same
 * change as the agent's `keep_attachment`, one undoable ADD_DOCUMENT.
 */
export function useKeepAttachment(token: string, session: string) {
  const { workspace } = useAppState();
  const dispatch = useAppDispatch();
  const [kept, setKept] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const canKeep = saveable(workspace);
  const documents = workspace?.documents;

  const keep = useCallback(
    async (attachmentId: string) => {
      setError(null);
      try {
        const att = (await listAttachments(token, session)).find((a) => a.id === attachmentId);
        if (!att?.path) throw new Error("This attachment is gone from the chat.");
        const doc = await keptDocument(documents ?? [], { name: att.name, path: att.path }, (p, n) =>
          apiClient.describeDocument(p, n),
        );
        if (typeof doc === "string") throw new Error(doc.replace(/^bad_command: /, ""));
        if (!("existing" in doc)) dispatch({ type: "ADD_DOCUMENT", document: doc });
        setKept((m) => ({ ...m, [attachmentId]: "existing" in doc ? doc.existing.id : doc.id }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [token, session, documents, dispatch],
  );

  // Kept = its document is still in the workspace (an Undo brings the button back).
  const isKept = (attachmentId: string) =>
    !!kept[attachmentId] && !!documents?.some((d) => d.id === kept[attachmentId]);
  return { keep: canKeep ? keep : null, isKept, error };
}
