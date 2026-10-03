import { uiAuthHeaders } from "../../../api/client";
import { parseSessionAttachment, type SessionAttachment } from "../panel/protocol";
import type { Attachment } from "./attachmentState";
import { readyAttachments } from "./attachmentState";

/**
 * Attachment routes of the engine (`docs/agent-chat-protocol.md`, "Attachments
 * (#121)"): upload with `PUT /api/uploads/{filename}`, register the returned
 * path per session, then send the attachment ids with the message. Read-only
 * for the agent; nothing here touches the workspace.
 */

const API_BASE: string = import.meta.env.VITE_API_URL ?? "/api";
const url = (path: string) => `${API_BASE.replace(/\/$/, "")}/ui/agent/attachments${path}`;

export interface RegisteredAttachment {
  id: string;
  kind?: string;
}

async function failure(res: Response, what: string): Promise<Error> {
  let message = `${what}: HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) message = body.message;
  } catch {
    /* no JSON body */
  }
  return new Error(res.status === 404 ? "This engine has no attachment routes (update dtk-engine)." : message);
}

/** `POST /ui/agent/attachments`: attach an uploaded file to the session's chat. */
export async function registerAttachment(
  token: string,
  session: string,
  path: string,
): Promise<RegisteredAttachment> {
  const res = await fetch(url(""), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...uiAuthHeaders(token) },
    body: JSON.stringify({ session, path }),
  });
  if (!res.ok) throw await failure(res, "POST /ui/agent/attachments");
  const body = (await res.json()) as { id?: unknown; kind?: unknown };
  if (typeof body.id !== "string") throw new Error("The engine returned no attachment id.");
  return { id: body.id, kind: typeof body.kind === "string" ? body.kind : undefined };
}

/** `GET /ui/agent/attachments?session=`: every file attached to the session's chat. */
export async function listAttachments(token: string, session: string): Promise<SessionAttachment[]> {
  const res = await fetch(url(`?session=${encodeURIComponent(session)}`), { headers: uiAuthHeaders(token) });
  if (!res.ok) throw await failure(res, "GET /ui/agent/attachments");
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? body.flatMap((a) => parseSessionAttachment(a) ?? []) : [];
}

/** `DELETE /ui/agent/attachments/<id>`: detach; the uploaded file stays on disk. */
export async function detachAttachment(token: string, session: string, id: string): Promise<void> {
  const res = await fetch(url(`/${encodeURIComponent(id)}?session=${encodeURIComponent(session)}`), {
    method: "DELETE",
    headers: uiAuthHeaders(token),
  });
  if (!res.ok && res.status !== 404) throw await failure(res, "DELETE /ui/agent/attachments");
}

/** The `attachments` field of `POST /ui/agent/send`; `undefined` when nothing is attached. */
export function toWire(items: Attachment[]): string[] | undefined {
  const ids = readyAttachments(items).flatMap((a) => (a.serverId ? [a.serverId] : []));
  return ids.length ? ids : undefined;
}
