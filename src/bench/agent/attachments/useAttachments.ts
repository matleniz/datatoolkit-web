import { useCallback, useReducer, useRef } from "react";

import { apiClient } from "../../../api/client";
import { attachmentReducer, NO_ATTACHMENTS, type Attachment } from "./attachmentState";
import { attachFile } from "./attachFlow";
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
  /** Chips removed before their registration settled (#128): detached, never shown ready. */
  const removed = useRef(new Set<string>());

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      for (const file of files) {
        const id = crypto.randomUUID();
        dispatch({ type: "add", id, name: file.name, size: file.size });
        attachFile(file, () => removed.current.has(id), {
          upload: (f) => apiClient.upload(f.name, f),
          register: (path) => registerAttachment(token, session, path),
          detach: (serverId) => detachAttachment(token, session, serverId),
        })
          .then((out) => {
            if (out.kind === "ready") {
              const att = out.attachment;
              dispatch({ type: "ready", id, serverId: att.id, kind: att.kind });
            }
          })
          .catch((err: unknown) =>
            dispatch({ type: "failed", id, error: err instanceof Error ? err.message : String(err) }),
          )
          .finally(() => removed.current.delete(id));
      }
    },
    [token, session],
  );

  const remove = useCallback(
    (id: string) => {
      const item = known.current.find((a) => a.id === id);
      dispatch({ type: "remove", id });
      if (item?.serverId) detachAttachment(token, session, item.serverId).catch(() => undefined);
      else if (item?.status === "uploading") removed.current.add(id);
    },
    [token, session],
  );
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  return { items, addFiles, remove, reset };
}
