import type { IdCounters } from "../api/types";

/**
 * Memory / document ids are never reused in a workspace (datatoolkit-issues#180):
 * the engine keeps the highest number handed out, Studio mints above it.
 */

/** `<key><n>`, n above every id in `ids` and above the counter. */
export function mintId(key: keyof IdCounters, ids: readonly string[], counters: IdCounters | undefined): string {
  const re = new RegExp(`^${key}(\\d+)$`);
  let top = counters?.[key] ?? 0;
  for (const id of ids) {
    const n = re.exec(id)?.[1];
    if (n !== undefined) top = Math.max(top, Number(n));
  }
  return `${key}${top + 1}`;
}

/** `counters` with the number of `id` recorded; the same object when already covered. */
export function withIdCounter(
  counters: IdCounters | undefined,
  key: keyof IdCounters,
  id: string,
): IdCounters | undefined {
  const n = Number(id.slice(key.length));
  if (!id.startsWith(key) || !Number.isInteger(n) || n <= (counters?.[key] ?? 0)) return counters;
  return { ...counters, [key]: n };
}
