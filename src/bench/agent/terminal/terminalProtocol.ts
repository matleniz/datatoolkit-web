/**
 * Terminal pack wire format (datatoolkit-issues#115). ASSUMED CONTRACT: the
 * engine has not documented its PTY WebSocket yet (docs/agent-chat-protocol.md);
 * everything that depends on it lives in this file and `terminalSocket.ts`, so
 * aligning is a local change.
 *
 * Route: `GET /api/ui/agent/terminal?session=<sid>&token=<token>` (upgrade).
 * Browsers cannot set headers on a WebSocket, so the token rides in the query
 * string, like `EventSource` on `/api/ui/events`.
 *
 * - client → server (text, JSON): `{type:"input", data}` keystrokes,
 *   `{type:"resize", cols, rows}`.
 * - server → client: binary frame = raw PTY output; text frame = JSON control
 *   `{type:"ready", pack}`, `{type:"exit", code}`, `{type:"error", message}`.
 */

export type ClientFrame =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export type ServerControl =
  | { type: "ready"; pack: string | null }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string };

export function terminalUrl(
  session: string,
  token: string,
  base: string,
  origin: string,
): string {
  const url = new URL(`${base.replace(/\/$/, "")}/ui/agent/terminal`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams({ session, token }).toString();
  return url.toString();
}

export function encodeFrame(frame: ClientFrame): string {
  return JSON.stringify(frame);
}

/** Parse a text frame; anything that is not a known control is ignored (null). */
export function parseControl(raw: string): ServerControl | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  switch (o.type) {
    case "ready":
      return { type: "ready", pack: typeof o.pack === "string" ? o.pack : null };
    case "exit":
      return { type: "exit", code: typeof o.code === "number" ? o.code : null };
    case "error":
      return { type: "error", message: typeof o.message === "string" ? o.message : "Terminal error" };
    default:
      return null;
  }
}
