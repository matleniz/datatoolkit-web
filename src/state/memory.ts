import type { MemoryEntry } from "../api/types";

/**
 * Agent memory per workspace (datatoolkit-issues#179): short entries the agent
 * reads at the start of each chat and updates with `remember` / `forget`;
 * stored in the workspace JSON, never part of a frame request or of the data
 * identity. Caps mirror the engine's validation (422 beyond).
 */

/** Longest entry text. */
export const MEMORY_TEXT_MAX = 500;
/** Most entries per workspace. */
const MEMORY_MAX_ENTRIES = 100;
/** Total text of all entries (~2k tokens). */
export const MEMORY_MAX_CHARS = 8000;

const ID_RE = /^m(\d+)$/;

/** `m<n>`, n the smallest above every existing `m<k>`. */
export function newMemoryId(entries: readonly MemoryEntry[]): string {
  let top = 0;
  for (const e of entries) {
    const n = ID_RE.exec(e.id)?.[1];
    if (n !== undefined) top = Math.max(top, Number(n));
  }
  return `m${top + 1}`;
}

/** Entries with `entry` replacing the one with its id, or appended. */
export function withMemoryEntry(
  entries: readonly MemoryEntry[] | undefined,
  entry: MemoryEntry,
): MemoryEntry[] {
  const list = entries ?? [];
  const at = list.findIndex((e) => e.id === entry.id);
  if (at < 0) return [...list, entry];
  const next = list.slice();
  next[at] = entry;
  return next;
}

export function memoryChars(entries: readonly MemoryEntry[]): number {
  return entries.reduce((n, e) => n + e.text.length, 0);
}

/** Why `entries` break a cap, or null when they fit. */
export function memoryCapError(entries: readonly MemoryEntry[]): string | null {
  if (entries.length > MEMORY_MAX_ENTRIES) return `more than ${MEMORY_MAX_ENTRIES} entries`;
  const chars = memoryChars(entries);
  if (chars > MEMORY_MAX_CHARS) return `${chars} characters, the cap is ${MEMORY_MAX_CHARS}`;
  return null;
}
