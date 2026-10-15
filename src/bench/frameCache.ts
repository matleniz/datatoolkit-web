/**
 * Loaded-frame cache (datatoolkit-issues#245): the grid page, profiles and
 * pipeline shapes of a (data identity, grid view) stay in memory, so switching
 * Train / Test (and back) or time-travelling to a version already loaded sends
 * no request.
 *
 * The key is the data identity (workspace, role, version and a hash of the
 * sources + params + steps up to that version) plus the grid view: changing a
 * source, its params or a step in the frame changes the key, so a stale entry
 * is never matched, only left to age out. Edits to the file itself are not
 * visible to the key: `clear()` is called when Studio writes a file
 * (uploads), when the tab becomes visible again, and by an explicit reload.
 *
 * Bounded LRU: each entry holds up to one page of rows (500 for narrow
 * frames, less for wide ones) and its profiles. Eight covers the two roles ×
 * a few viewed versions or grid views without letting a long session grow.
 */
const FRAME_CACHE_SIZE = 8;

/**
 * Entries expire: a file rewritten on disk (an agent run, a script) is not
 * visible to the key, so a frame is trusted for a minute at most.
 */
const FRAME_CACHE_TTL_MS = 60_000;

/**
 * Whether a settled frame may be cached: only the first page (rows scrolled in
 * by loadMore would grow an entry without bound; a hit resumes paging), and
 * never a frame that carried a load-time error (empty-source mismatch, root
 * shape failure), which a hit would hide.
 */
export function isCacheable(f: {
  rows: number;
  firstPageMax: number;
  totalUnfiltered: number;
  hadError: boolean;
}): boolean {
  return f.rows <= f.firstPageMax && f.totalUnfiltered > 0 && !f.hadError;
}

export class FrameCache<T> {
  private readonly entries = new Map<string, { value: T; at: number }>();

  constructor(
    private readonly capacity: number = FRAME_CACHE_SIZE,
    private readonly ttlMs: number = FRAME_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (hit === undefined) return undefined;
    this.entries.delete(key);
    if (this.now() - hit.at > this.ttlMs) return undefined;
    // Re-insert: Map iteration order is the recency order.
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, at: this.now() });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
