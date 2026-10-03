/**
 * Chat attachments (datatoolkit-issues#116): files the user adds to a message.
 * They are uploaded as read-only material for the agent; the workspace
 * sources, label and merges are never touched. File names are untrusted text.
 */

export type AttachmentStatus = "uploading" | "ready" | "failed";

export interface Attachment {
  id: string;
  name: string;
  size: number;
  status: AttachmentStatus;
  /** Server-side path returned by the upload route (ready only). */
  path?: string;
  error?: string;
}

export type AttachmentAction =
  | { type: "add"; id: string; name: string; size: number }
  | { type: "ready"; id: string; path: string }
  | { type: "failed"; id: string; error: string }
  | { type: "remove"; id: string }
  | { type: "reset" };

export const NO_ATTACHMENTS: Attachment[] = [];

export function attachmentReducer(state: Attachment[], action: AttachmentAction): Attachment[] {
  switch (action.type) {
    case "add":
      return [...state, { id: action.id, name: action.name, size: action.size, status: "uploading" }];
    case "ready":
      return state.map((a) =>
        a.id === action.id ? { ...a, status: "ready", path: action.path, error: undefined } : a,
      );
    case "failed":
      return state.map((a) =>
        a.id === action.id ? { ...a, status: "failed", error: action.error } : a,
      );
    case "remove":
      return state.filter((a) => a.id !== action.id);
    case "reset":
      return NO_ATTACHMENTS;
  }
}

export const readyAttachments = (items: Attachment[]): Attachment[] =>
  items.filter((a) => a.status === "ready");

export const isUploading = (items: Attachment[]): boolean =>
  items.some((a) => a.status === "uploading");

/** A message goes out with text and no upload still in flight; failed chips are skipped. */
export function canSend(text: string, items: Attachment[]): boolean {
  return text.trim().length > 0 && !isUploading(items);
}

/** `1536` -> `1.5 KB`. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
