import type { AgentEvent, UsageTotals } from "./protocol";

/**
 * The panel's message list, folded from the chat events (pure, unit-tested).
 * Kept in memory only: a reload starts a fresh transcript (the engine owns
 * the agent session).
 */

/**
 * `review` = waiting in Studio's review banner (destructive step edits), then
 * `applied` / `rejected` once the user decided (or `error`: stale, timeout...).
 */
type ToolStatus = "running" | "review" | "applied" | "rejected" | "ok" | "error";
type PermissionStatus = "pending" | "allowed" | "denied";

export type TranscriptItem =
  | { kind: "user"; key: string; text: string; local?: boolean }
  | { kind: "assistant"; key: string; text: string }
  | {
      kind: "tool";
      key: string;
      id: string;
      name: string;
      input: Record<string, unknown>;
      status: ToolStatus;
      summary?: string;
      error?: string;
      /** Bridge command id of a UI command (polled while under review). */
      command?: string;
    }
  | {
      kind: "permission";
      key: string;
      id: string;
      tool: string;
      summary: string;
      lines: string[];
      status: PermissionStatus;
    }
  | { kind: "error"; key: string; message: string; code?: string };

export interface Transcript {
  items: TranscriptItem[];
  /** A turn is in flight (Stop is offered). */
  running: boolean;
  usage: UsageTotals;
  seq: number;
}

export const EMPTY_TRANSCRIPT: Transcript = {
  items: [],
  running: false,
  usage: { input: 0, output: 0 },
  seq: 0,
};

export type TranscriptAction =
  | { type: "event"; event: AgentEvent }
  /** The user sent a message (shown before the engine echoes it). */
  | { type: "sent"; text: string }
  | { type: "reply"; id: string; allow: boolean }
  /** Final ack of a reviewed command (`GET /api/ui/commands/{id}`). */
  | { type: "command_status"; command: string; ok: boolean; error?: string }
  /** Seed the cumulative usage from `GET /api/ui/agent`. */
  | { type: "usage_seed"; usage: UsageTotals }
  | { type: "local_error"; message: string }
  | { type: "clear" };

type NewItem = TranscriptItem extends infer T ? (T extends TranscriptItem ? Omit<T, "key"> : never) : never;

function push(t: Transcript, item: NewItem): Transcript {
  const seq = t.seq + 1;
  return { ...t, seq, items: [...t.items, { ...item, key: `m${seq}` } as TranscriptItem] };
}

function patchById(
  t: Transcript,
  kind: "tool" | "permission",
  id: string,
  patch: Partial<TranscriptItem>,
): Transcript {
  let hit = false;
  const items = t.items.map((it) => {
    if (it.kind !== kind || it.id !== id) return it;
    hit = true;
    return { ...it, ...patch } as TranscriptItem;
  });
  return hit ? { ...t, items } : t;
}

function onUserMessage(t: Transcript, text: string): Transcript {
  // The engine echoes what we already show: adopt the local copy.
  const idx = t.items.findIndex((it) => it.kind === "user" && it.local && it.text === text);
  if (idx >= 0) {
    const items = t.items.slice();
    items[idx] = { ...items[idx], local: false } as TranscriptItem;
    return { ...t, items, running: true };
  }
  return { ...push(t, { kind: "user", text }), running: true };
}

function onDelta(t: Transcript, text: string): Transcript {
  const last = t.items[t.items.length - 1];
  if (last?.kind === "assistant") {
    const items = t.items.slice(0, -1);
    items.push({ ...last, text: last.text + text });
    return { ...t, items, running: true };
  }
  return { ...push(t, { kind: "assistant", text }), running: true };
}

function onUsage(t: Transcript, ev: Extract<AgentEvent, { type: "usage" }>): Transcript {
  const usage = ev.total ?? {
    input: t.usage.input + ev.inputTokens,
    output: t.usage.output + ev.outputTokens,
  };
  return { ...t, usage };
}

/** Pending tools / permissions of a finished turn will never resolve. */
function settle(t: Transcript): Transcript {
  const items = t.items.map((it) => {
    if (it.kind === "tool" && it.status === "running") return { ...it, status: "error" as const };
    if (it.kind === "permission" && it.status === "pending") {
      return { ...it, status: "denied" as const };
    }
    return it;
  });
  return { ...t, items, running: false };
}

function toolStatus(ev: Extract<AgentEvent, { type: "tool_result" }>): ToolStatus {
  if (!ev.ok) return "error";
  return ev.pending === "review" ? "review" : "ok";
}

function onCommandStatus(
  t: Transcript,
  { command, ok, error }: Extract<TranscriptAction, { type: "command_status" }>,
): Transcript {
  const status: ToolStatus = ok ? "applied" : error === "rejected" ? "rejected" : "error";
  const items = t.items.map((it) =>
    it.kind === "tool" && it.command === command && it.status === "review"
      ? { ...it, status, error: status === "error" ? error : undefined }
      : it,
  );
  return { ...t, items };
}

/** Bridge command ids of the chips still waiting for the user's review. */
export function reviewCommands(t: Transcript): string[] {
  return t.items.flatMap((it) =>
    it.kind === "tool" && it.status === "review" && it.command ? [it.command] : [],
  );
}

function applyEvent(t: Transcript, ev: AgentEvent): Transcript {
  switch (ev.type) {
    case "user_message":
      return onUserMessage(t, ev.text);
    case "assistant_delta":
      return onDelta(t, ev.text);
    case "tool_call":
      return push(t, {
        kind: "tool", id: ev.id, name: ev.name, input: ev.input, status: "running",
      });
    case "tool_result":
      return patchById(t, "tool", ev.id, {
        status: toolStatus(ev),
        summary: ev.summary,
        error: ev.error,
        command: ev.command,
      });
    case "permission_request":
      return push(t, {
        kind: "permission",
        id: ev.id,
        tool: ev.tool,
        summary: ev.summary,
        lines: ev.lines,
        status: "pending",
      });
    case "usage":
      return onUsage(t, ev);
    case "config":
      // A pack change starts a new conversation engine-side (usage is kept).
      return ev.reset ? { ...EMPTY_TRANSCRIPT, usage: t.usage, seq: t.seq } : t;
    case "done":
      return settle(t);
    case "error":
      return settle(push(t, { kind: "error", message: ev.message, code: ev.code }));
  }
}

export function transcriptReducer(t: Transcript, action: TranscriptAction): Transcript {
  switch (action.type) {
    case "event":
      return applyEvent(t, action.event);
    case "sent":
      return { ...push(t, { kind: "user", text: action.text, local: true }), running: true };
    case "reply":
      return patchById(t, "permission", action.id, {
        status: action.allow ? "allowed" : "denied",
      });
    case "command_status":
      return onCommandStatus(t, action);
    case "usage_seed":
      return t.usage.input + t.usage.output > 0 ? t : { ...t, usage: action.usage };
    case "local_error":
      return settle(push(t, { kind: "error", message: action.message }));
    case "clear":
      return { ...EMPTY_TRANSCRIPT, usage: t.usage, seq: t.seq };
  }
}

/** 340, 1.2k, 12k */
export function formatTokens(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

/** "1.2k in · 340 out" */
export function formatUsage(u: UsageTotals): string {
  return `${formatTokens(u.input)} in · ${formatTokens(u.output)} out`;
}
