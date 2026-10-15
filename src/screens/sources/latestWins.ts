/**
 * Ordering guard for the workspace list (#244): the list is fetched on mount,
 * after each save and after each sidebar action, and the engine may answer
 * out of order. A response is applied only when nothing newer was requested
 * or applied since it was issued, so a slow mount-time fetch can no longer
 * overwrite a workspace the user created meanwhile.
 */
export function createLatestWins() {
  let generation = 0;
  return {
    /** Mark a request as issued (or a newer value as applied); returns its ticket. */
    next(): number {
      generation += 1;
      return generation;
    },
    /** True while `ticket` is still the most recent one. */
    isCurrent(ticket: number): boolean {
      return ticket === generation;
    },
  };
}
