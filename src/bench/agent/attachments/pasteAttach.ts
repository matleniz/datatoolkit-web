import type { ClipboardEvent } from "react";

import type { Attachments } from "./useAttachments";

const DEFAULT_THRESHOLD = 4000;

/** Pastes longer than this many characters become a text attachment (`VITE_PASTE_ATTACH_THRESHOLD`). */
export function pasteThreshold(raw: unknown = import.meta.env.VITE_PASTE_ATTACH_THRESHOLD): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_THRESHOLD;
}

export function isLongPaste(text: string, threshold: number = pasteThreshold()): boolean {
  return text.length > threshold;
}

/** `pasted-text-1.txt`, `pasted-text-2.txt`, … unique among the names already used. */
export function pastedName(taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`pasted-text-${n}.txt`)) n += 1;
  return `pasted-text-${n}.txt`;
}

/**
 * Paste handler for the message box: a long paste is uploaded as a text
 * attachment (never a workspace document) and `onPlaceholder` receives the
 * short line left in the box. Short pastes fall through untouched.
 */
export function handlePaste(
  e: ClipboardEvent<HTMLTextAreaElement>,
  attachments: Attachments,
  onPlaceholder: (line: string) => void,
): void {
  const text = e.clipboardData.getData("text/plain");
  if (!isLongPaste(text)) return;
  e.preventDefault();
  const name = pastedName(attachments.items.map((a) => a.name));
  attachments.addFiles([new File([text], name, { type: "text/plain" })]);
  onPlaceholder(`[Pasted text attached: ${name}, ${text.length} characters]`);
}
