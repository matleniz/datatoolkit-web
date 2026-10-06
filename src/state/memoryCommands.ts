import { MEMORY_KINDS, type IdCounters, type MemoryEntry, type MemoryKind } from "../api/types";
import type { Ack, BridgeDeps } from "./agentCommands";
import { MEMORY_TEXT_MAX, memoryCapError, newMemoryId, withMemoryEntry } from "./memory";
import { currentIdentityKey } from "./uiContext";

/**
 * `remember` / `forget` (datatoolkit-issues#179): the agent writes its
 * workspace memory through the reducer, one undoable change each (toast +
 * Undo, like `set_note`), persisted before the ack.
 */
export type MemoryCommand =
  | { type: "remember"; workspace: string; text: string; kind?: MemoryKind; memory_id?: string }
  | { type: "forget"; workspace: string; memory_id: string };

type Parsed<T> = T | { error: string };

export function parseRemember(raw: Record<string, unknown>): Parsed<MemoryCommand> {
  if (typeof raw.workspace !== "string") return { error: "workspace must be a string" };
  if (typeof raw.text !== "string" || raw.text.trim() === "") {
    return { error: "text must be a non-empty string" };
  }
  if (raw.text.length > MEMORY_TEXT_MAX) {
    return { error: `text longer than ${MEMORY_TEXT_MAX} characters` };
  }
  if (raw.kind !== undefined && !MEMORY_KINDS.includes(raw.kind as MemoryKind)) {
    return { error: `kind must be one of ${MEMORY_KINDS.join(", ")}` };
  }
  if (raw.memory_id !== undefined && (typeof raw.memory_id !== "string" || !raw.memory_id)) {
    return { error: "memory_id must be a non-empty string" };
  }
  return {
    type: "remember",
    workspace: raw.workspace,
    text: raw.text,
    ...(raw.kind !== undefined ? { kind: raw.kind as MemoryKind } : {}),
    ...(raw.memory_id !== undefined ? { memory_id: raw.memory_id as string } : {}),
  };
}

export function parseForget(raw: Record<string, unknown>): Parsed<MemoryCommand> {
  if (typeof raw.workspace !== "string") return { error: "workspace must be a string" };
  if (typeof raw.memory_id !== "string" || !raw.memory_id) {
    return { error: "memory_id must be a non-empty string" };
  }
  return { type: "forget", workspace: raw.workspace, memory_id: raw.memory_id };
}

/** `2026-10-06T14:03:11Z` (seconds, UTC). */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A short quote of an entry for the toast. */
function quote(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return `“${one.length > 60 ? `${one.slice(0, 59)}…` : one}”`;
}

const fail = (id: string, error: string): Ack => ({ id, ok: false, error });

/** The entry `remember` writes, or a refusal. */
function rememberedEntry(
  cmd: Extract<MemoryCommand, { type: "remember" }>,
  entries: readonly MemoryEntry[],
  counters: IdCounters | undefined,
): MemoryEntry | string {
  if (cmd.memory_id === undefined) {
    return { id: newMemoryId(entries, counters), text: cmd.text, kind: cmd.kind ?? "fact", updated_at: nowIso() };
  }
  const old = entries.find((e) => e.id === cmd.memory_id);
  if (!old) return `bad_command: unknown memory id ${cmd.memory_id}`;
  return { id: old.id, text: cmd.text, kind: cmd.kind ?? old.kind, updated_at: nowIso() };
}

export async function runMemoryCommand(
  id: string,
  cmd: MemoryCommand,
  deps: BridgeDeps,
): Promise<Ack> {
  const ws = deps.getState().workspace;
  if (ws?.name !== cmd.workspace) {
    return fail(
      id,
      `stale: workspace ${JSON.stringify(cmd.workspace)} is not open in Studio (open: ${JSON.stringify(ws?.name ?? null)})`,
    );
  }
  const entries = ws.memory ?? [];
  let memoryId: string;
  let summary: string;
  if (cmd.type === "remember") {
    const entry = rememberedEntry(cmd, entries, ws.id_counters);
    if (typeof entry === "string") return fail(id, entry);
    const full = memoryCapError(withMemoryEntry(entries, entry));
    if (full) return fail(id, `bad_command: memory full (${full})`);
    deps.dispatch({ type: "SET_MEMORY_ENTRY", entry });
    memoryId = entry.id;
    summary = `${cmd.memory_id === undefined ? "remembered" : `updated ${entry.id}:`} ${quote(entry.text)}`;
  } else {
    const old = entries.find((e) => e.id === cmd.memory_id);
    if (!old) return fail(id, `bad_command: unknown memory id ${cmd.memory_id}`);
    deps.dispatch({ type: "REMOVE_MEMORY_ENTRY", id: cmd.memory_id });
    memoryId = cmd.memory_id;
    summary = `forgot ${quote(old.text)}`;
  }
  try {
    await deps.settle();
  } catch (e) {
    return fail(id, `save_failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  deps.announce(summary, [{ type: "UNDO_STEPS" }]);
  const ack: Ack = { id, ok: true, identity: currentIdentityKey(deps.getState()) };
  return cmd.type === "remember" ? { ...ack, memory_id: memoryId } : ack;
}
