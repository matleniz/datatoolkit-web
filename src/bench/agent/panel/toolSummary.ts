/**
 * Compact, text-only views of a tool call's input / output for the expanded
 * chip (datatoolkit-issues#113). Values are untrusted (column names, cell
 * values): everything here returns plain strings, rendered as text nodes.
 */

/** Longest value shown before "show more". */
export const VALUE_MAX = 120;
/** Most `key: value` lines shown for one object. */
export const LINES_MAX = 12;

export interface SummaryLine {
  key: string;
  /** Compact value, cut at `VALUE_MAX`. */
  short: string;
  /** Full compact value, differs from `short` only when `truncated`. */
  full: string;
  truncated: boolean;
}

export function truncate(text: string, max: number = VALUE_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Strings as is, anything else as compact JSON (never throws). */
export function compactValue(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export function summaryLines(obj: Record<string, unknown>, max: number = VALUE_MAX): SummaryLine[] {
  return Object.entries(obj).map(([key, value]) => {
    const full = compactValue(value);
    const short = truncate(full, max);
    return { key, short, full, truncated: short !== full };
  });
}

/** How many input lines are hidden behind the "+N more" cut. */
export function hiddenLines(obj: Record<string, unknown>, max: number = LINES_MAX): number {
  return Math.max(0, Object.keys(obj).length - max);
}
