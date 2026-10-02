/**
 * Chat event protocol of the in-Studio agent panel (datatoolkit-issues#67).
 *
 * The engine's chat adapter (first pack: Claude Agent SDK; `stub` for e2e)
 * translates its agent's stream into these events, sent as `event: agent` on
 * the UI bridge SSE stream (`/api/ui/events`); the panel answers over POST
 * (`/api/ui/agent/send|cancel|permission`). Unknown types and malformed
 * events are dropped (a newer engine may send more).
 */

export interface UsageTotals {
  input: number;
  output: number;
}

export type AgentEvent =
  | { type: "user_message"; text: string }
  | { type: "assistant_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      id: string;
      ok: boolean;
      summary?: string;
      error?: string;
      identity?: string;
      /** A destructive `propose_steps` held by Studio's review banner. */
      pending?: "review";
      command?: string;
    }
  | {
      type: "permission_request";
      id: string;
      tool: string;
      input: Record<string, unknown>;
      summary: string;
      lines: string[];
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      /** Cumulative per session, when the engine keeps it. */
      total?: UsageTotals;
    }
  | { type: "done"; stopReason?: string }
  | { type: "error"; message: string; code?: string };

/** `GET /api/ui/agent`: which pack runs, or why there is none. */
export interface AgentStatus {
  available: boolean;
  pack: string | null;
  provider?: string;
  model?: string;
  /** Why no agent (missing key, extra not installed, ...). */
  reason?: string;
  running: boolean;
  usage?: UsageTotals;
  maxTokens?: number;
}

const MCP_PREFIX = /^mcp__.+?__/;

/** `mcp__dtk__propose_steps` -> `propose_steps`. */
export function toolName(raw: string): string {
  return raw.replace(MCP_PREFIX, "");
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

function parseUsage(o: Obj): AgentEvent {
  const hasTotal =
    typeof o.total_input_tokens === "number" ||
    typeof o.total_output_tokens === "number";
  return {
    type: "usage",
    inputTokens: num(o.input_tokens),
    outputTokens: num(o.output_tokens),
    total: hasTotal
      ? { input: num(o.total_input_tokens), output: num(o.total_output_tokens) }
      : undefined,
  };
}

function parsePermission(o: Obj): AgentEvent | null {
  const id = str(o.id);
  if (!id) return null;
  const tool = toolName(str(o.tool) ?? str(o.name) ?? "tool");
  const lines = Array.isArray(o.lines) ? o.lines.filter((l) => typeof l === "string") : [];
  return {
    type: "permission_request",
    id,
    tool,
    input: isObj(o.input) ? o.input : {},
    summary: str(o.summary) ?? tool,
    lines,
  };
}

/** One SSE `agent` payload (already JSON-decoded) -> event, or null to drop. */
export function parseAgentEvent(raw: unknown): AgentEvent | null {
  if (!isObj(raw)) return null;
  const o = raw;
  switch (o.type) {
    case "user_message":
    case "assistant_delta": {
      const text = str(o.text);
      return text === undefined ? null : { type: o.type, text };
    }
    case "tool_call": {
      const id = str(o.id);
      const name = str(o.name);
      if (!id || !name) return null;
      return { type: "tool_call", id, name: toolName(name), input: isObj(o.input) ? o.input : {} };
    }
    case "tool_result": {
      const id = str(o.id);
      if (!id) return null;
      return {
        type: "tool_result",
        id,
        ok: o.ok !== false,
        summary: str(o.summary),
        error: str(o.error),
        identity: str(o.identity),
        pending: o.pending === "review" ? "review" : undefined,
        command: str(o.command),
      };
    }
    case "permission_request":
      return parsePermission(o);
    case "usage":
      return parseUsage(o);
    case "done":
      return { type: "done", stopReason: str(o.stop_reason) };
    case "error":
      return { type: "error", message: str(o.message) ?? "agent error", code: str(o.code) };
    default:
      return null;
  }
}

/** `GET /api/ui/agent` body -> status; anything unexpected reads as "no agent". */
export function parseAgentStatus(raw: unknown): AgentStatus {
  if (!isObj(raw)) return { available: false, pack: null, running: false };
  const usage = isObj(raw.usage)
    ? { input: num(raw.usage.input_tokens), output: num(raw.usage.output_tokens) }
    : undefined;
  return {
    available: raw.available === true,
    pack: str(raw.pack) ?? null,
    provider: str(raw.provider),
    model: str(raw.model),
    reason: str(raw.reason),
    running: raw.running === true,
    usage,
    maxTokens: typeof raw.max_tokens === "number" ? raw.max_tokens : undefined,
  };
}
