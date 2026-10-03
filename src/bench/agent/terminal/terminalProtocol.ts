/**
 * Terminal pack wire format (datatoolkit-issues#115), as documented in the
 * engine's docs/agent-chat-protocol.md, section "Terminal (#120)".
 *
 * `WS /api/ui/terminal?session=&pack=&model=&cols=&rows=&token=`. Browsers
 * cannot set headers on a WebSocket, so the token rides in the query string.
 *
 * - client → engine: binary = keystrokes (PTY input as is); text = JSON
 *   `{type:"resize", cols, rows}`.
 * - engine → client: binary = PTY output bytes (fed to xterm undecoded); text
 *   = JSON control `started`, `exit`, `error`.
 * - a refused connection is accepted then closed with 44xx (see `closeReason`).
 */

export type ServerControl =
  | { type: "started"; pack: string | null; model: string | null }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string };

export function terminalUrl(
  p: { session: string; token: string; pack: string; cols: number; rows: number; model?: string },
  base: string,
  origin: string,
): string {
  const url = new URL(`${base.replace(/\/$/, "")}/ui/terminal`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const q = new URLSearchParams({
    session: p.session,
    pack: p.pack,
    cols: String(p.cols),
    rows: String(p.rows),
    token: p.token,
  });
  if (p.model) q.set("model", p.model);
  url.search = q.toString();
  return url.toString();
}

export function encodeResize(cols: number, rows: number): string {
  return JSON.stringify({ type: "resize", cols, rows });
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
    case "started":
      return {
        type: "started",
        pack: typeof o.pack === "string" ? o.pack : null,
        model: typeof o.model === "string" ? o.model : null,
      };
    case "exit":
      return { type: "exit", code: typeof o.code === "number" ? o.code : null };
    case "error":
      return { type: "error", message: typeof o.message === "string" ? o.message : "Terminal error" };
    default:
      return null;
  }
}

/** What a refused / lost connection means for the user; null = nothing special. */
export function closeReason(code: number): string | null {
  switch (code) {
    case 4401:
      return "The bridge token was refused. Reload Studio.";
    case 4403:
      return "The engine refused the connection (terminal off, or origin / host not allowed). Start it with DTK_AGENT_TERMINAL=1.";
    case 4404:
      return "The engine does not know this terminal pack.";
    case 4409:
      return "This session already has a terminal for that pack (another tab?).";
    case 4422:
      return "The engine rejected the model or terminal size.";
    default:
      return null;
  }
}
