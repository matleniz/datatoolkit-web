import { useCallback, useReducer, useRef } from "react";

import { apiClient } from "../../../api/client";
import { attachmentReducer, NO_ATTACHMENTS, type Attachment } from "./attachmentState";
import { detachAttachment, registerAttachment } from "./attachmentContract";

export interface Attachments {
  items: Attachment[];
  addFiles(files: Iterable<File>): void;
  remove(id: string): void;
  /** Clears the chips after a send (the engine keeps the attachments for later turns). */
  reset(): void;
}

/** Upload (`PUT /api/uploads/{filename}`), then register the path with the session's chat. */
export function useAttachments(token: string, session: string): Attachments {
  const [items, dispatch] = useReducer(attachmentReducer, NO_ATTACHMENTS);
  const known = useRef(items);
  known.current = items;

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      for (const file of files) {
        const id = crypto.randomUUID();
        dispatch({ type: "add", id, name: file.name, size: file.size });
        apiClient
          .upload(file.name, file)
          .then((up) => registerAttachment(token, session, up.path))
          .then((att) => dispatch({ type: "ready", id, serverId: att.id, kind: att.kind }))
          .catch((err: unknown) =>
            dispatch({ type: "failed", id, error: err instanceof Error ? err.message : String(err) }),
          );
      }
    },
    [token, session],
  );

  const remove = useCallback(
    (id: string) => {
      const serverId = known.current.find((a) => a.id === id)?.serverId;
      dispatch({ type: "remove", id });
      if (serverId) detachAttachment(token, session, serverId).catch(() => undefined);
    },
    [token, session],
  );
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  return { items, addFiles, remove, reset };
}
