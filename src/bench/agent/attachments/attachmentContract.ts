import type { Attachment } from "./attachmentState";
import { readyAttachments } from "./attachmentState";

/**
 * The only place that knows how attachments travel on `POST /api/ui/agent/send`.
 * The engine side (dtk-chat2-engine E4, `docs/agent-chat-protocol.md`) does not
 * document it yet: this is the working assumption, an `attachments` array of
 * `{name, path}` next to `text`. Align here once the engine doc lands.
 */
export interface WireAttachment {
  name: string;
  path: string;
}

/** `undefined` when nothing is attached, so a plain send keeps its old body. */
export function toWire(items: Attachment[]): WireAttachment[] | undefined {
  const ready = readyAttachments(items).flatMap((a) =>
    a.path ? [{ name: a.name, path: a.path }] : [],
  );
  return ready.length ? ready : undefined;
}
