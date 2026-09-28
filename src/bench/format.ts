import type { JsonValue } from "../api/types";

export function isNull(v: unknown): boolean {
  return v === null || v === undefined;
}

export function same(a: unknown, b: unknown): boolean {
  return (isNull(a) && isNull(b)) || a === b;
}

export function r3(v: number | null | undefined): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return Math.round(v * 1000) / 1000;
}

export function fmt(v: JsonValue | undefined): string {
  if (isNull(v)) return "∅";
  if (typeof v === "number") {
    return String(Number.isInteger(v) ? v : r3(v));
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function cellDisplay(v: JsonValue | undefined): string {
  if (isNull(v)) return "missing";
  if (typeof v === "string" && v !== v.trim()) return `“${v}”`;
  return fmt(v as JsonValue);
}

/** Column header / name display — quote leading/trailing spaces like cells. */
export function nameDisplay(name: string): string {
  if (name !== name.trim()) return `“${name}”`;
  return name;
}

/** Render fitted state from preview_step.state as readable lines. */
export function formatLearnedState(state: Record<string, JsonValue>): string {
  if (!state || Object.keys(state).length === 0) {
    return "Not fitted: nothing is learned on train";
  }
  if ("dropped" in state) {
    return `${state.dropped} rows dropped on train`;
  }
  if ("fill" in state && state.fill && typeof state.fill === "object") {
    const fill = state.fill as Record<string, JsonValue>;
    return Object.entries(fill)
      .map(([c, v]) => `${c}: fill value = ${fmt(v)}`)
      .join("\n");
  }
  if ("variables" in state && state.variables && typeof state.variables === "object") {
    const vars = state.variables as Record<string, JsonValue>;
    const keys = Object.keys(vars);
    if (!keys.length) return "No variable used: nothing learned.";
    return keys.map((n) => `@${n} = ${fmt(vars[n]!)}`).join("\n");
  }
  return JSON.stringify(state, null, 2);
}
