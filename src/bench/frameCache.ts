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

export class FrameCache<T> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly capacity: number = FRAME_CACHE_SIZE) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (hit === undefined) return undefined;
    // Re-insert: Map iteration order is the recency order.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, value);
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
