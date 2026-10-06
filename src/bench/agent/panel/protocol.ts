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
  /** Every input token: uncached + cache writes + cache reads. */
  input: number;
  output: number;
  /** Of `input`: written to / read from the prompt cache (#151; 0 when not reported). */
  cacheWrite: number;
  cacheRead: number;
}

/** One turn's usage, plus the context size (input of its last API call; 0 when not reported). */
export interface TurnUsage extends UsageTotals {
  context: number;
}

/** A file attached to the session's chat (`{id, name, kind}`; names are untrusted text). */
export interface SessionAttachment {
  id: string;
  name: string;
  kind?: string;
  /** Upload ref; in `GET /ui/agent/attachments`, used to keep it as a document (#178). */
  path?: string;
}

export type AgentEvent =
  | { type: "user_message"; text: string; attachments?: SessionAttachment[] }
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
      turn: TurnUsage;
      /** Cumulative per session, when the engine keeps it. */
      total?: UsageTotals;
    }
  /** The session's pack / model changed (`POST /api/ui/agent/config`). */
  | { type: "config"; pack: string | null; model: string | null; reset: boolean }
  /** The session's attachment set changed (datatoolkit-issues#121, #129). */
  | { type: "attachment_added"; attachment: SessionAttachment }
  | { type: "attachment_removed"; id: string }
  /** The pack summarised older turns (#151); `preTokens` = context size before. */
  | { type: "compacted"; preTokens?: number }
  | { type: "done"; stopReason?: string }
  | { type: "error"; message: string; code?: string };

export type PackMode = "api" | "cli" | "test";
export type PackPanel = "chat" | "terminal";

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
  /** What an alias resolves to (`sonnet` -> `claude-sonnet-5-5`). */
  resolved?: string;
}

/** One entry of `GET /api/ui/agent/options`. */
export interface PackOption {
  id: string;
  title: string;
  mode: PackMode;
  panel: PackPanel;
  available: boolean;
  /** Why unavailable (missing key, CLI not logged in, extra not installed...). */
  reason?: string;
  provider?: string;
  defaultModel: string | null;
  models: ModelOption[];
  /** No model list from the provider: the model is typed in. */
  modelFreeText: boolean;
  modelsError?: string;
}

export interface AgentOptions {
  default: { pack: string | null; model: string | null };
  packs: PackOption[];
}

/** `GET /api/ui/agent`: which pack runs, or why there is none. */
export interface AgentStatus {
  available: boolean;
  pack: string | null;
  provider?: string;
  model?: string;
  /** Display name, how the pack runs and which panel it opens (engine v2). */
  title?: string;
  mode?: PackMode;
  panel?: PackPanel;
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

/** Token counts under `prefix` (`""` = the turn, `"total_"` = cumulative). */
function parseTokens(o: Obj, prefix = ""): UsageTotals {
  return {
    input: num(o[`${prefix}input_tokens`]),
    output: num(o[`${prefix}output_tokens`]),
    cacheWrite: num(o[`${prefix}cache_creation_input_tokens`]),
    cacheRead: num(o[`${prefix}cache_read_input_tokens`]),
  };
}

function parseUsage(o: Obj): AgentEvent {
  const hasTotal =
    typeof o.total_input_tokens === "number" ||
    typeof o.total_output_tokens === "number";
  return {
    type: "usage",
    turn: { ...parseTokens(o), context: num(o.context_tokens) },
    total: hasTotal ? parseTokens(o, "total_") : undefined,
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

/** `{id, name, kind, path?}` of an attachment, or null when malformed. */
export function parseSessionAttachment(raw: unknown): SessionAttachment | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const path = str(raw.path);
  return { id, name: str(raw.name) ?? id, kind: str(raw.kind), ...(path ? { path } : {}) };
}

function parseUserMessage(o: Obj): AgentEvent | null {
  const text = str(o.text);
  if (text === undefined) return null;
  const attachments = Array.isArray(o.attachments)
    ? o.attachments.flatMap((a) => parseSessionAttachment(a) ?? [])
    : [];
  return attachments.length
    ? { type: "user_message", text, attachments }
    : { type: "user_message", text };
}

/** One SSE `agent` payload (already JSON-decoded) -> event, or null to drop. */
export function parseAgentEvent(raw: unknown): AgentEvent | null {
  if (!isObj(raw)) return null;
  const o = raw;
  switch (o.type) {
    case "user_message":
      return parseUserMessage(o);
    case "assistant_delta": {
      const text = str(o.text);
      return text === undefined ? null : { type: o.type, text };
    }
    case "attachment_added": {
      const attachment = parseSessionAttachment(o.attachment);
      return attachment ? { type: "attachment_added", attachment } : null;
    }
    case "attachment_removed": {
      const id = str(o.id);
      return id ? { type: "attachment_removed", id } : null;
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
    case "config":
      return {
        type: "config",
        pack: str(o.pack) ?? null,
        model: str(o.model) ?? null,
        reset: o.reset === true,
      };
    case "compacted":
      return {
        type: "compacted",
        ...(typeof o.pre_tokens === "number" ? { preTokens: o.pre_tokens } : {}),
      };
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
  const usage = isObj(raw.usage) ? parseTokens(raw.usage) : undefined;
  return {
    available: raw.available === true,
    pack: str(raw.pack) ?? null,
    provider: str(raw.provider),
    model: str(raw.model),
    title: str(raw.title),
    mode: packMode(raw.mode),
    panel: packPanel(raw.panel),
    reason: str(raw.reason),
    running: raw.running === true,
    usage,
    maxTokens: typeof raw.max_tokens === "number" ? raw.max_tokens : undefined,
  };
}

function packMode(v: unknown): PackMode | undefined {
  return v === "api" || v === "cli" || v === "test" ? v : undefined;
}

function packPanel(v: unknown): PackPanel | undefined {
  return v === "chat" || v === "terminal" ? v : undefined;
}

function parseModel(raw: unknown): ModelOption | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    label: str(raw.label) ?? id,
    description: str(raw.description),
    resolved: str(raw.resolved),
  };
}

function parsePack(raw: unknown): PackOption | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const mode = packMode(raw.mode);
  const panel = packPanel(raw.panel);
  if (!id || !mode || !panel) return null;
  const models = Array.isArray(raw.models)
    ? raw.models.flatMap((m) => parseModel(m) ?? [])
    : [];
  return {
    id,
    title: str(raw.title) ?? id,
    mode,
    panel,
    available: raw.available === true,
    reason: str(raw.reason),
    provider: str(raw.provider),
    defaultModel: str(raw.default_model) ?? null,
    models,
    modelFreeText: raw.model_free_text === true,
    modelsError: str(raw.models_error),
  };
}

/**
 * `GET /api/ui/agent/options` body -> options. Unknown / malformed packs and
 * models are dropped (a newer engine may send more); a body that is not an
 * options object reads as "no options" (null: no selector).
 */
export function parseAgentOptions(raw: unknown): AgentOptions | null {
  if (!isObj(raw) || !Array.isArray(raw.packs)) return null;
  const def = isObj(raw.default) ? raw.default : {};
  const seen = new Set<string>();
  const packs = raw.packs.flatMap((p) => {
    const pack = parsePack(p);
    if (!pack || seen.has(pack.id)) return [];
    seen.add(pack.id);
    return [pack];
  });
  return { default: { pack: str(def.pack) ?? null, model: str(def.model) ?? null }, packs };
}
