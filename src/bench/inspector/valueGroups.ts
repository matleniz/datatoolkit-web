import type { JsonValue, TopValue, WorkspaceRow } from "../../api/types";

export interface ValueGroup {
  /** Canonical form (strip + lower). */
  to: string;
  /** Raw spellings joined like the prototype: `"Paris"  "paris"`. */
  from: string;
}

function asString(v: JsonValue | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/**
 * Group raw spellings that collapse to the same strip+lower form.
 * Mirrors the prototype's `valueGroups`: keep groups with >1 raw spelling,
 * or a single spelling that is not already canonical.
 *
 * Prefer `top_values` (engine); fall back to loaded rows when we need more
 * distinct values than the profile's top-N.
 */
export function valueGroupsFromTopValues(
  topValues: TopValue[] | null | undefined,
): ValueGroup[] {
  if (!topValues?.length) return [];
  return groupSpellings(topValues.map((t) => asString(t.value)).filter(Boolean) as string[]);
}

export function valueGroupsFromRows(
  rows: WorkspaceRow[],
  column: string,
): ValueGroup[] {
  const spellings: string[] = [];
  for (const r of rows) {
    const s = asString(r[column] as JsonValue | undefined);
    if (s !== null) spellings.push(s);
  }
  return groupSpellings(spellings);
}

/**
 * Build value groups for a text column. Uses top_values first; if the profile
 * reports more distinct values than top_values covers, also scan loaded rows.
 */
export function buildValueGroups(opts: {
  topValues: TopValue[] | null | undefined;
  distinct?: number;
  rows?: WorkspaceRow[];
  column?: string;
}): ValueGroup[] {
  const fromTop = valueGroupsFromTopValues(opts.topValues);
  const topCount = opts.topValues?.length ?? 0;
  const distinct = opts.distinct ?? topCount;
  if (
    opts.rows &&
    opts.column &&
    distinct > topCount &&
    opts.rows.length > 0
  ) {
    // Merge spellings from rows so we don't miss rare variants.
    const fromRows = valueGroupsFromRows(opts.rows, opts.column);
    return mergeGroups(fromTop, fromRows);
  }
  return fromTop;
}

function groupSpellings(spellings: string[]): ValueGroup[] {
  const g: Record<string, Record<string, 1>> = {};
  for (const s of spellings) {
    const k = s.trim().toLowerCase();
    if (!g[k]) g[k] = {};
    g[k]![s] = 1;
  }
  return Object.keys(g)
    .filter((k) => {
      const raws = Object.keys(g[k]!);
      return raws.length > 1 || raws[0] !== k;
    })
    .map((k) => ({
      to: k,
      from: Object.keys(g[k]!)
        .map((s) => `"${s}"`)
        .join("  "),
    }));
}

function mergeGroups(a: ValueGroup[], b: ValueGroup[]): ValueGroup[] {
  const byTo: Record<string, Set<string>> = {};
  const ingest = (groups: ValueGroup[]) => {
    for (const g of groups) {
      if (!byTo[g.to]) byTo[g.to] = new Set();
      // from is `"a"  "b"` — re-parse roughly by splitting on `  "`
      const parts = g.from.match(/"([^"]*)"/g) ?? [];
      for (const p of parts) {
        byTo[g.to]!.add(p.slice(1, -1));
      }
    }
  };
  ingest(a);
  ingest(b);
  return Object.keys(byTo)
    .filter((k) => {
      const raws = [...byTo[k]!];
      return raws.length > 1 || raws[0] !== k;
    })
    .map((k) => ({
      to: k,
      from: [...byTo[k]!].map((s) => `"${s}"`).join("  "),
    }));
}
