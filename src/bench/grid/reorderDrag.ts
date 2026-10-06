/**
 * Drag a grid header to reorder columns (datatoolkit-issues#161). Pure logic:
 * turns "input order -> wanted order" into one `reorder_columns` step, so
 * consecutive drags fold into a single step instead of piling up.
 */

export interface ReorderParams {
  columns: string[];
  position: "first" | "last" | "after";
  anchor?: string;
}

/** `order` with `name` moved to slot `to` (index in the list without `name`). */
export function moveColumn(
  order: string[],
  name: string,
  to: number,
): string[] {
  const rest = order.filter((c) => c !== name);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), name, ...rest.slice(at)];
}

/** Wanted order when `name` is dropped on `target` (before or after it). */
export function dropOrder(
  order: string[],
  name: string,
  target: string,
  side: "before" | "after",
): string[] | null {
  if (name === target) return null;
  const rest = order.filter((c) => c !== name);
  const t = rest.indexOf(target);
  if (t < 0 || rest.length === order.length) return null;
  return moveColumn(order, name, side === "before" ? t : t + 1);
}

/** Columns of `input` outside one longest common subsequence with `wanted`. */
function movedColumns(input: string[], wanted: string[]): Set<string> {
  const pos = new Map(wanted.map((c, i) => [c, i]));
  const seq = input.map((c) => pos.get(c) ?? -1);
  // Longest increasing subsequence of positions (patience, O(n log n)).
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  seq.forEach((p, i) => {
    if (p < 0) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((tails[mid] as number) < p) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = p;
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? (tailIdx[lo - 1] as number) : -1;
  });
  const kept = new Set<number>();
  for (let i = tailIdx[tailIdx.length - 1] ?? -1; i >= 0; i = prev[i] as number)
    kept.add(i);
  return new Set(input.filter((_, i) => !kept.has(i)));
}

/**
 * One step turning `input` into `wanted`: `"identity"` when nothing moves,
 * `null` when the moved columns are not contiguous (no single step fits).
 */
export function planReorder(
  input: string[],
  wanted: string[],
): ReorderParams | "identity" | null {
  if (input.length !== wanted.length) return null;
  if (input.every((c, i) => c === wanted[i])) return "identity";
  const moved = movedColumns(input, wanted);
  const idx = wanted.flatMap((c, i) => (moved.has(c) ? [i] : []));
  if (idx.length === 0) return null;
  const first = idx[0] as number;
  const last = idx[idx.length - 1] as number;
  if (last - first + 1 !== idx.length) return null;
  const columns = wanted.slice(first, last + 1);
  if (first === 0) return { columns, position: "first" };
  if (last === wanted.length - 1) return { columns, position: "last" };
  return { columns, position: "after", anchor: wanted[first - 1] };
}

/** Column order produced by a `reorder_columns` step (strict params only). */
export function applyReorder(input: string[], p: ReorderParams): string[] {
  const rest = input.filter((c) => !p.columns.includes(c));
  if (p.position === "first") return [...p.columns, ...rest];
  if (p.position === "last") return [...rest, ...p.columns];
  const a = rest.indexOf(p.anchor ?? "");
  return [...rest.slice(0, a + 1), ...p.columns, ...rest.slice(a + 1)];
}
