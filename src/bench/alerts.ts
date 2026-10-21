import type { ColumnKind, ColumnProfile } from "../api/types";

export interface ColAlert {
  text: string;
  tone: "muted" | "warn" | "info" | "outlier";
}

/** Up to 2 alerts for a column header / inspector, from engine profiles. */
export function colAlerts(profile: ColumnProfile | undefined): ColAlert[] {
  if (!profile) return [];
  const A: ColAlert[] = [];
  if (profile.kind === "identifier") {
    A.push({ text: "identifier", tone: "muted" });
  }
  const sent = profile.sentinel_candidates?.[0];
  if (sent && sent.count > 0) {
    A.push({
      text: `${fmtSent(sent.value)} ×${sent.count}`,
      tone: "warn",
    });
  }
  if (profile.missing > 0) {
    A.push({ text: `${profile.missing} missing`, tone: "warn" });
  }
  if (profile.kind === "text" && profile.looks_like_dates) {
    A.push({ text: "text dates", tone: "info" });
  } else if (profile.kind === "text" && profile.currency_as_text) {
    A.push({ text: "currency as text", tone: "info" });
  } else if (profile.kind === "text" && profile.numbers_as_text) {
    A.push({ text: "numbers as text", tone: "info" });
  } else if (profile.kind === "text" && profile.variants) {
    A.push({
      text: `${profile.variants.raw} spellings`,
      tone: "warn",
    });
  }
  if (profile.kind === "number" && profile.outliers > 0) {
    A.push({
      text: `${profile.outliers} outlier${profile.outliers > 1 ? "s" : ""}`,
      tone: "outlier",
    });
  }
  return A.slice(0, 2);
}

function fmtSent(v: unknown): string {
  return String(v);
}

export interface HistBar {
  n: number;
  tip: string;
  label: string;
  heightPx: number;
}

/** Mini histogram / top-values bars from a ColumnProfile. */
export function profileBars(
  profile: ColumnProfile,
  maxH: number,
  minW = 2,
): HistBar[] {
  const bars: { n: number; tip: string; label: string }[] = [];
  if (profile.histogram && profile.histogram.counts.length) {
    const { edges, counts } = profile.histogram;
    counts.forEach((n, i) => {
      const lo = edges[i];
      const hi = edges[i + 1];
      bars.push({
        n,
        tip: `${lo} – ${hi}: ${n}`,
        label: "",
      });
    });
  } else if (profile.top_values && profile.top_values.length) {
    const limit =
      profile.kind === "date" || profile.kind === "identifier" ? 12 : 8;
    profile.top_values.slice(0, limit).forEach((tv) => {
      bars.push({
        n: tv.count,
        tip: `"${String(tv.value)}": ${tv.count}`,
        label: String(tv.value),
      });
    });
  }
  const mx = Math.max(...bars.map((b) => b.n), 1);
  return bars.map((b) => ({
    ...b,
    heightPx: Math.max(b.n ? 2 : 0, Math.round((b.n / mx) * maxH)),
    minW,
  }));
}

export function missPct(profile: ColumnProfile | undefined): number {
  if (!profile) return 0;
  // ColumnProfile.count is the non-null count; rows = count + missing.
  const rows = profile.count + profile.missing;
  return rows ? Math.round((profile.missing / rows) * 100) : 0;
}

export interface QualityShares {
  rows: number;
  valid: number;
  mismatched: number;
  missing: number;
  /** Whole percentages summing to 100 (0/0/0 when there are no rows). */
  validPct: number;
  mismatchedPct: number;
  missingPct: number;
}

/**
 * Valid / mismatched / missing split of a column, from the profile alone.
 * Mismatched is an approximation: the non-null values the engine flagged as
 * sentinel candidates (e.g. -999, "N/A"); other format problems
 * (numbers_as_text, text dates) carry no per-value count and are not included.
 */
export function qualityShares(
  profile: ColumnProfile | undefined,
): QualityShares {
  const none = {
    rows: 0,
    valid: 0,
    mismatched: 0,
    missing: 0,
    validPct: 0,
    mismatchedPct: 0,
    missingPct: 0,
  };
  if (!profile) return none;
  const missing = Math.max(0, profile.missing);
  const nonNull = Math.max(0, profile.count);
  const rows = nonNull + missing;
  if (!rows) return none;
  const sentinels = (profile.sentinel_candidates ?? []).reduce(
    (n, s) => n + Math.max(0, s.count),
    0,
  );
  const mismatched = Math.min(sentinels, nonNull);
  const missingPct = Math.round((missing / rows) * 100);
  const mismatchedPct = Math.min(
    Math.round((mismatched / rows) * 100),
    100 - missingPct,
  );
  return {
    rows,
    valid: nonNull - mismatched,
    mismatched,
    missing,
    validPct: 100 - missingPct - mismatchedPct,
    mismatchedPct,
    missingPct,
  };
}

/** Tooltip for the quality bar; states that mismatched is approximate. */
export function qualityTip(q: QualityShares): string {
  return [
    `Valid ${q.validPct}% (${q.valid})`,
    `Mismatched ${q.mismatchedPct}% (${q.mismatched}) — approximate: counts sentinel-like values only`,
    `Missing ${q.missingPct}% (${q.missing})`,
  ].join("\n");
}

export function isOutlierValue(
  profile: ColumnProfile | undefined,
  value: unknown,
  kind: ColumnKind,
): boolean {
  if (kind !== "number" || typeof value !== "number" || value === -999) {
    return false;
  }
  const b = profile?.iqr_bounds;
  if (!b) return false;
  return value < b.lo || value > b.hi;
}
