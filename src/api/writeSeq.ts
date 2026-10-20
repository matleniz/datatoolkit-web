/**
 * Per-tab write sequence for `PUT /workspaces/{name}` (datatoolkit-issues#263).
 *
 * The engine refuses (409 `stale_write`) a PUT whose `X-Dtk-Write-Seq` is
 * lower than the highest one it accepted for that workspace, so an older write
 * that reaches the engine late cannot overwrite a newer one. The value is
 * strictly increasing across every workspace PUT of the tab, and roughly
 * ordered across tabs by the clock.
 */
export const WRITE_SEQ_HEADER = "X-Dtk-Write-Seq";

let lastSeq = 0;

/** Next sequence: `max(previous + 1, Date.now() * 1000)`; an integer below 2^53. */
export function nextWriteSeq(): number {
  lastSeq = Math.max(lastSeq + 1, Math.floor(Date.now() * 1000));
  return lastSeq;
}

/** @internal vitest helper. */
export function resetWriteSeqForTests(): void {
  lastSeq = 0;
}
