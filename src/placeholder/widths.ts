/**
 * Deterministic pseudo-random widths for skeleton lines and cells. Same inputs,
 * same output: a placeholder never re-rolls between renders, so it does not
 * flicker, and snapshots stay stable.
 */
export function skeletonWidths(count: number, seed = 0, min = 45, max = 95): number[] {
  let s = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out.push(min + (s % (max - min + 1)));
  }
  return out;
}
