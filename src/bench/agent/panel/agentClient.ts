import { uiAuthHeaders } from "../../../api/client";
import type { WireAttachment } from "../attachments/attachmentContract";
import { parseAgentStatus, type AgentStatus } from "./protocol";

/**
 * Agent chat routes of the UI bridge (`/api/ui/agent*`, datatoolkit-issues#67),
 * same per-run token as the rest of `/api/ui`. Engine errors come back as
 * `{type, message}` (503 `NoAgent`, 409 `AgentBusy`, 404 `UnknownPermission`).
 */

const API_BASE: string = import.meta.env.VITE_API_URL ?? "/api";
const agentUrl = (path = "") => `${API_BASE.replace(/\/$/, "")}/ui/agent${path}`;

export class AgentHttpError extends Error {
  constructor(
    readonly status: number,
    readonly kind: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

async function fail(res: Response, what: string): Promise<never> {
  let kind: string | undefined;
  let message = `${what}: HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { type?: unknown; message?: unknown };
    if (typeof body.type === "string") kind = body.type;
    if (typeof body.message === "string" && body.message) message = body.message;
  } catch {
    /* no JSON body */
  }
  throw new AgentHttpError(res.status, kind, message);
}

/** Status of the engine's agent pack; an engine without the routes = no agent. */
export async function getAgentStatus(token: string): Promise<AgentStatus> {
  const res = await fetch(agentUrl(), { headers: uiAuthHeaders(token) });
  if (res.status === 404) {
    return {
      available: false,
      pack: null,
      running: false,
      reason: "This engine has no agent routes (update dtk-engine).",
    };
  }
  if (!res.ok) await fail(res, "GET /ui/agent");
  return parseAgentStatus(await res.json());
}

/**
 * `GET /api/ui/commands/{id}`: the final ack of a recent command, or null while
 * it waits for the user's review (or when the engine no longer knows it).
 */
export async function getCommandStatus(
  token: string,
  id: string,
): Promise<{ ok: boolean; error?: string } | null> {
  const url = `${API_BASE.replace(/\/$/, "")}/ui/commands/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: uiAuthHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) await fail(res, "GET /ui/commands");
  const body = (await res.json()) as { ok?: unknown; error?: unknown };
  if (typeof body.ok !== "boolean") return null;
  return { ok: body.ok, error: typeof body.error === "string" ? body.error : undefined };
}

async function post(token: string, path: string, body: unknown): Promise<Response> {
  const res = await fetch(agentUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...uiAuthHeaders(token) },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res, `POST /ui/agent${path}`);
  return res;
}

export async function sendAgentMessage(
  token: string,
  session: string,
  text: string,
  attachments?: WireAttachment[],
): Promise<void> {
  await post(token, "/send", attachments ? { session, text, attachments } : { session, text });
}

export async function cancelAgent(token: string, session: string): Promise<void> {
  await post(token, "/cancel", { session });
}

export async function replyPermission(
  token: string,
  session: string,
  id: string,
  allow: boolean,
): Promise<void> {
  await post(token, "/permission", { session, id, allow });
}
