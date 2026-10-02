export function round3(v: number | null): number | null {
  if (v === null || Number.isNaN(v)) return null;
  return Math.round(v * 1000) / 1000;
}

export function fmtStat(v: number | null): string {
  if (v === null) return "∅";
  return String(Number.isInteger(v) ? v : round3(v));
}
