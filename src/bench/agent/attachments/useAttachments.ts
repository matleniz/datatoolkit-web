import { useCallback, useReducer } from "react";

import { apiClient } from "../../../api/client";
import { attachmentReducer, NO_ATTACHMENTS, type Attachment } from "./attachmentState";

export interface Attachments {
  items: Attachment[];
  addFiles(files: Iterable<File>): void;
  remove(id: string): void;
  reset(): void;
}

/** Uploads each file through `PUT /api/uploads/{filename}` as soon as it is added. */
export function useAttachments(): Attachments {
  const [items, dispatch] = useReducer(attachmentReducer, NO_ATTACHMENTS);

  const addFiles = useCallback((files: Iterable<File>) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      dispatch({ type: "add", id, name: file.name, size: file.size });
      apiClient
        .upload(file.name, file)
        .then((res) => dispatch({ type: "ready", id, path: res.path }))
        .catch((err: unknown) =>
          dispatch({ type: "failed", id, error: err instanceof Error ? err.message : String(err) }),
        );
    }
  }, []);

  const remove = useCallback((id: string) => dispatch({ type: "remove", id }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  return { items, addFiles, remove, reset };
}
